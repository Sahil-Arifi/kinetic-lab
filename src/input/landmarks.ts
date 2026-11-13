/** Minimal subset of the 21 MediaPipe landmarks required for pinch recognition. */
export interface HandLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface PinchObservation {
  /** Thumb-to-index distance divided by index-MCP-to-pinky-MCP distance. */
  ratio: number;
  /** Normalized preview coordinates, mirrored exactly once when requested. */
  cursor: { x: number; y: number };
  palmWidthPixels: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

const finitePoint = (point: HandLandmark | undefined): point is HandLandmark =>
  point !== undefined &&
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  point.x >= -0.5 &&
  point.x <= 1.5 &&
  point.y >= -0.5 &&
  point.y <= 1.5;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * A pure, fail-closed MediaPipe landmark adapter. Both axes are measured in
 * image pixels, not raw normalized coordinates (which distort portrait frames).
 * No camera access, persistent storage, or inference happens here.
 */
export function observePinch(
  landmarks: readonly HandLandmark[],
  frame: FrameSize,
  mirror = false,
): PinchObservation | null {
  if (
    landmarks.length !== 21 ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  )
    return null;

  const thumb = landmarks[4];
  const index = landmarks[8];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];
  if (!finitePoint(thumb) || !finitePoint(index) || !finitePoint(indexMcp) || !finitePoint(pinkyMcp)) return null;

  const distance = (a: HandLandmark, b: HandLandmark): number =>
    Math.hypot((a.x - b.x) * frame.width, (a.y - b.y) * frame.height);
  const palmWidthPixels = distance(indexMcp, pinkyMcp);
  // Tiny or degenerate palms produce unstable ratios and false positives.
  if (!Number.isFinite(palmWidthPixels) || palmWidthPixels < Math.max(12, frame.width * 0.015))
    return null;

  const ratio = distance(thumb, index) / palmWidthPixels;
  if (!Number.isFinite(ratio) || ratio < 0) return null;
  const centerX = clampUnit((thumb.x + index.x) / 2);
  return {
    ratio,
    cursor: {
      x: mirror ? 1 - centerX : centerX,
      y: clampUnit((thumb.y + index.y) / 2),
    },
    palmWidthPixels,
  };
}
