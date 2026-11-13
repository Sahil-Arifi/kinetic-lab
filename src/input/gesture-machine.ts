/** Deterministic, camera-independent pinch transitions for the future hand adapter. */
export type GesturePhase =
  | 'SEARCHING'
  | 'HOVERING'
  | 'PINCH_PENDING'
  | 'GRABBING'
  | 'RELEASING'
  | 'TRACKING_LOST';

export type GestureIntent = 'none' | 'beginGrab' | 'moveGrab' | 'endGrab' | 'cancelGrab';

export interface GestureConfig {
  pinchEnterRatio: number;
  pinchExitRatio: number;
  enterDwellMs: number;
  exitDwellMs: number;
  trackingLostAfterMs: number;
}

export const DEFAULT_GESTURE_CONFIG: Readonly<GestureConfig> = Object.freeze({
  pinchEnterRatio: 0.22,
  pinchExitRatio: 0.32,
  enterDwellMs: 80,
  exitDwellMs: 60,
  trackingLostAfterMs: 200,
});

export interface GestureState {
  phase: GesturePhase;
  phaseStartedMs: number | null;
  lastTimestampMs: number | null;
  lastSeenMs: number | null;
}

export interface GestureSample {
  timestampMs: number;
  /** Missing or invalid tracking must be supplied as null. */
  pinchRatio: number | null;
}

export interface GestureTransition {
  state: GestureState;
  intent: GestureIntent;
}

export function validateGestureConfig(config: GestureConfig): GestureConfig {
  const values = Object.values(config);
  if (values.some((v) => !Number.isFinite(v))) throw new RangeError('Gesture config must be finite.');
  if (
    config.pinchEnterRatio <= 0 ||
    config.pinchExitRatio <= config.pinchEnterRatio ||
    config.pinchExitRatio > 1 ||
    config.enterDwellMs < 0 ||
    config.exitDwellMs < 0 ||
    config.trackingLostAfterMs <= 0 ||
    config.trackingLostAfterMs > 10000
  )
    throw new RangeError('Invalid pinch thresholds or dwell times.');
  return { ...config };
}

export function initialGestureState(): GestureState {
  return { phase: 'SEARCHING', phaseStartedMs: null, lastTimestampMs: null, lastSeenMs: null };
}

/**
 * Each call yields at most one intent. A missing frame cannot count toward an
 * entry dwell, and loss of an active hand produces cancelGrab, never endGrab.
 * TRACKING_LOST requires an observed open hand before it can rearm.
 */
export function advanceGesture(
  previous: GestureState,
  sample: GestureSample,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): GestureTransition {
  if (!Number.isFinite(sample.timestampMs) || sample.timestampMs < 0)
    throw new RangeError('Frame timestamp must be a nonnegative finite number.');
  if (previous.lastTimestampMs !== null && sample.timestampMs <= previous.lastTimestampMs)
    return { state: previous, intent: 'none' };

  const at = sample.timestampMs;
  const ratio = sample.pinchRatio;
  const tracked = ratio !== null && Number.isFinite(ratio) && ratio >= 0;
  const next: GestureState = { ...previous, lastTimestampMs: at };
  if (!tracked) {
    if (
      previous.lastSeenMs !== null &&
      at - previous.lastSeenMs >= config.trackingLostAfterMs
    ) {
      next.phase = 'TRACKING_LOST';
      next.phaseStartedMs = at;
      return {
        state: next,
        intent:
          previous.phase === 'GRABBING' || previous.phase === 'RELEASING'
            ? 'cancelGrab'
            : 'none',
      };
    }
    // Broken visibility interrupts entry dwell even before loss timeout.
    if (previous.phase === 'PINCH_PENDING') {
      next.phase = 'SEARCHING';
      next.phaseStartedMs = null;
    }
    return { state: next, intent: 'none' };
  }

  // A long gap is tracking loss even if no intermediate empty frame arrived.
  if (
    previous.phase !== 'TRACKING_LOST' &&
    previous.lastSeenMs !== null &&
    at - previous.lastSeenMs >= config.trackingLostAfterMs
  ) {
    next.phase = 'TRACKING_LOST';
    next.phaseStartedMs = at;
    return {
      state: next,
      intent:
        previous.phase === 'GRABBING' || previous.phase === 'RELEASING'
          ? 'cancelGrab'
          : 'none',
    };
  }

  // The tracked branch establishes that the ratio is finite and nonnegative.
  const pinch = ratio as number;
  next.lastSeenMs = at;
  if (previous.phase === 'TRACKING_LOST') {
    if (pinch >= config.pinchExitRatio) {
      next.phase = 'HOVERING';
      next.phaseStartedMs = null;
    }
    return { state: next, intent: 'none' };
  }

  if (previous.phase === 'SEARCHING' || previous.phase === 'HOVERING') {
    next.phase = pinch < config.pinchEnterRatio ? 'PINCH_PENDING' : 'HOVERING';
    next.phaseStartedMs = next.phase === 'PINCH_PENDING' ? at : null;
    return { state: next, intent: 'none' };
  }

  if (previous.phase === 'PINCH_PENDING') {
    if (pinch >= config.pinchEnterRatio) {
      next.phase = 'HOVERING';
      next.phaseStartedMs = null;
      return { state: next, intent: 'none' };
    }
    if (at - (previous.phaseStartedMs ?? at) >= config.enterDwellMs) {
      next.phase = 'GRABBING';
      next.phaseStartedMs = null;
      return { state: next, intent: 'beginGrab' };
    }
    return { state: next, intent: 'none' };
  }

  if (previous.phase === 'GRABBING') {
    if (pinch >= config.pinchExitRatio) {
      next.phase = 'RELEASING';
      next.phaseStartedMs = at;
    }
    return { state: next, intent: 'moveGrab' };
  }

  // RELEASING remains a physical grab until open-hand dwell completes.
  if (pinch < config.pinchExitRatio) {
    next.phase = 'GRABBING';
    next.phaseStartedMs = null;
    return { state: next, intent: 'moveGrab' };
  }
  if (at - (previous.phaseStartedMs ?? at) >= config.exitDwellMs) {
    next.phase = 'HOVERING';
    next.phaseStartedMs = null;
    return { state: next, intent: 'endGrab' };
  }
  return { state: next, intent: 'moveGrab' };
}

/** Explicit cancellation on disable/reset/visibility transitions. */
export function resetGesture(previous: GestureState): GestureTransition {
  return {
    state: initialGestureState(),
    intent:
      previous.phase === 'GRABBING' || previous.phase === 'RELEASING'
        ? 'cancelGrab'
        : 'none',
  };
}
