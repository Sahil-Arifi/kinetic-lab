import { describe, expect, it } from 'vitest';
import { observePinch, type HandLandmark } from '../../src/input/landmarks';
import {
  DEFAULT_GESTURE_CONFIG,
  advanceGesture,
  initialGestureState,
  resetGesture,
  validateGestureConfig,
  type GestureState,
} from '../../src/input/gesture-machine';

const frame = { width: 640, height: 480 };
function hand(thumbX = 0.5, indexX = 0.51): HandLandmark[] {
  const points: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[4] = { x: thumbX, y: 0.5 };
  points[8] = { x: indexX, y: 0.5 };
  points[5] = { x: 0.4, y: 0.5 };
  points[17] = { x: 0.6, y: 0.5 };
  return points;
}
function advance(state: GestureState, time: number, ratio: number | null) {
  return advanceGesture(state, { timestampMs: time, pinchRatio: ratio });
}
function grabbing() {
  let state = initialGestureState();
  state = advance(state, 0, 0.1).state;
  return advance(state, 80, 0.1).state;
}

describe('MediaPipe landmark adaptation (without a camera)', () => {
  it('uses pixel-correct geometry, a palm-scale ratio and exactly one mirror transform', () => {
    const source = hand(0.5, 0.51);
    expect(observePinch(source, frame)?.ratio).toBeCloseTo(0.05);
    const portrait = observePinch(source, { width: 480, height: 640 });
    expect(portrait?.ratio).toBeCloseTo(0.05);
    const mirrored = observePinch(hand(0.2, 0.21), frame, true);
    const plain = observePinch(hand(0.2, 0.21), frame);
    expect(mirrored?.cursor.x).toBeCloseTo(1 - (plain?.cursor.x ?? 0));
    expect(mirrored?.cursor.y).toBe(plain?.cursor.y);
    expect(mirrored?.palmWidthPixels).toBeCloseTo(128);
  });

  it('accounts for aspect ratio when fingertip movement is vertical', () => {
    const points = hand(0.5, 0.5);
    points[8] = { x: 0.5, y: 0.6 };
    expect(observePinch(points, frame)?.ratio).toBeCloseTo(48 / 128);
    expect(observePinch(points, { width: 480, height: 640 })?.ratio).toBeCloseTo(64 / 96);
  });

  it('rejects missing and implausible landmarks without throwing', () => {
    expect(observePinch(hand().slice(0, 20), frame)).toBeNull();
    expect(observePinch(hand(), { width: 0, height: 480 })).toBeNull();
    expect(observePinch(hand(), { width: 640, height: -1 })).toBeNull();
    expect(observePinch(hand(), { width: NaN, height: 480 })).toBeNull();
    expect(observePinch(hand(), { width: 640, height: Infinity })).toBeNull();
    const missing = hand();
    missing[8] = { x: NaN, y: 0.5 };
    expect(observePinch(missing, frame)).toBeNull();
    const impossible = hand();
    impossible[5] = { x: -1, y: 0.5 };
    expect(observePinch(impossible, frame)).toBeNull();
    const badY = hand();
    badY[17] = { x: 0.6, y: Infinity };
    expect(observePinch(badY, frame)).toBeNull();
    const degenerate = hand();
    degenerate[17] = { x: 0.4, y: 0.5 };
    expect(observePinch(degenerate, frame)).toBeNull();
    const tooSmall = hand();
    tooSmall[17] = { x: 0.401, y: 0.5 };
    expect(observePinch(tooSmall, frame)).toBeNull();
  });

  it('clamps cursor to the image without persisting landmarks', () => {
    const points = hand(-0.2, -0.1);
    expect(observePinch(points, frame)?.cursor.x).toBe(0);
    points[4] = { x: 1.1, y: 1.1 };
    points[8] = { x: 1.2, y: 1.2 };
    expect(observePinch(points, frame)?.cursor).toEqual({ x: 1, y: 1 });
  });
});

describe('pure pinch state machine', () => {
  it('validates thresholds, finite timing, and loss timeouts', () => {
    expect(validateGestureConfig(DEFAULT_GESTURE_CONFIG)).toEqual(DEFAULT_GESTURE_CONFIG);
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, pinchEnterRatio: 0 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, pinchExitRatio: 0.1 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, pinchExitRatio: 2 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, enterDwellMs: -1 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, exitDwellMs: -1 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, trackingLostAfterMs: 0 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, trackingLostAfterMs: 10001 })).toThrow();
    expect(() => validateGestureConfig({ ...DEFAULT_GESTURE_CONFIG, exitDwellMs: NaN })).toThrow();
  });

  it('requires sustained pinch rather than a single frame', () => {
    let result = advance(initialGestureState(), 0, 0.1);
    expect(result).toMatchObject({ state: { phase: 'PINCH_PENDING' }, intent: 'none' });
    result = advance(result.state, 79, 0.1);
    expect(result.intent).toBe('none');
    result = advance(result.state, 80, 0.1);
    expect(result).toMatchObject({ state: { phase: 'GRABBING' }, intent: 'beginGrab' });
    expect(advance(result.state, 90, 0.1).intent).toBe('moveGrab');
  });

  it('discards brief pinches and closes pending on threshold crossing', () => {
    let result = advance(initialGestureState(), 0, 0.5);
    expect(result.state.phase).toBe('HOVERING');
    result = advance(result.state, 10, 0.15);
    result = advance(result.state, 30, 0.22);
    expect(result.state.phase).toBe('HOVERING');
    expect(result.intent).toBe('none');
  });

  it('waits for release dwell, with hysteresis against noisy reopening', () => {
    let state = grabbing();
    let result = advance(state, 100, 0.4);
    expect(result).toMatchObject({ state: { phase: 'RELEASING' }, intent: 'moveGrab' });
    result = advance(result.state, 120, 0.30);
    expect(result.state.phase).toBe('GRABBING');
    result = advance(result.state, 140, 0.4);
    result = advance(result.state, 199, 0.5);
    expect(result.intent).toBe('moveGrab');
    result = advance(result.state, 200, 0.5);
    expect(result).toMatchObject({ state: { phase: 'HOVERING' }, intent: 'endGrab' });
    state = result.state;
    expect(advance(state, 210, 0.5).intent).toBe('none');
  });

  it('cancels an active grab after prolonged loss, but never emits an end grab', () => {
    let result = advance(grabbing(), 100, null);
    expect(result).toMatchObject({ state: { phase: 'GRABBING' }, intent: 'none' });
    result = advance(result.state, 280, null);
    expect(result).toMatchObject({ state: { phase: 'TRACKING_LOST' }, intent: 'cancelGrab' });
    expect(advance(result.state, 300, null).intent).toBe('none');
  });

  it('cancels when loss occurs during release dwell', () => {
    let result = advance(grabbing(), 100, 0.45);
    expect(result.state.phase).toBe('RELEASING');
    result = advance(result.state, 301, null);
    expect(result.intent).toBe('cancelGrab');
  });

  it('treats a long timestamp gap as tracking loss without an empty frame', () => {
    const result = advance(grabbing(), 281, 0.1);
    expect(result).toMatchObject({ state: { phase: 'TRACKING_LOST' }, intent: 'cancelGrab' });
  });

  it('requires a visibly open hand after tracking loss before rearming', () => {
    let state = advance(grabbing(), 281, null).state;
    expect(state.phase).toBe('TRACKING_LOST');
    state = advance(state, 290, 0.1).state;
    expect(state.phase).toBe('TRACKING_LOST');
    state = advance(state, 310, 0.33).state;
    expect(state.phase).toBe('HOVERING');
    state = advance(state, 320, 0.1).state;
    expect(state.phase).toBe('PINCH_PENDING');
    expect(advance(state, 400, 0.1).intent).toBe('beginGrab');
  });

  it('breaks entry dwell on missing frames before the tracking-loss timeout', () => {
    let result = advance(initialGestureState(), 0, 0.1);
    result = advance(result.state, 40, null);
    expect(result.state.phase).toBe('SEARCHING');
    result = advance(result.state, 50, 0.1);
    expect(advance(result.state, 85, 0.1).intent).toBe('none');
    expect(advance(result.state, 130, 0.1).intent).toBe('beginGrab');
  });

  it('handles missing input before any hand is seen', () => {
    const result = advance(initialGestureState(), 1000, null);
    expect(result.state.phase).toBe('SEARCHING');
    expect(result.intent).toBe('none');
  });

  it('enters tracking lost without cancellation if no grab was active', () => {
    let result = advance(initialGestureState(), 0, 0.4);
    result = advance(result.state, 201, null);
    expect(result).toMatchObject({ state: { phase: 'TRACKING_LOST' }, intent: 'none' });
  });

  it('ignores old/duplicate frames and rejects invalid frame times', () => {
    const state = grabbing();
    const duplicate = advance(state, 80, 0.5);
    expect(duplicate.state).toBe(state);
    expect(duplicate.intent).toBe('none');
    const old = advance(state, 40, 0.5);
    expect(old.state).toBe(state);
    expect(() => advance(state, NaN, 0.5)).toThrow();
    expect(() => advance(state, -1, 0.5)).toThrow();
    expect(() => advance(state, Infinity, 0.5)).toThrow();
  });

  it('treats NaN/negative observed ratios as tracking failure', () => {
    const state = grabbing();
    expect(advance(state, 100, NaN).intent).toBe('none');
    expect(advance(state, 281, -1).intent).toBe('cancelGrab');
  });

  it('resets safely on scene reset, visibility change, or camera disable', () => {
    expect(resetGesture(grabbing())).toMatchObject({
      state: { phase: 'SEARCHING' },
      intent: 'cancelGrab',
    });
    const releasing = advance(grabbing(), 100, 0.5).state;
    expect(resetGesture(releasing).intent).toBe('cancelGrab');
    expect(resetGesture(initialGestureState()).intent).toBe('none');
  });
});
