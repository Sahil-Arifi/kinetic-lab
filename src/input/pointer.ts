import type { Vec3 } from '../engine/scene-schema';

function finite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError('Pointer coordinates must be finite.');
}

export function clampDepth(value: number, min = -5, max = 5): number {
  [value, min, max].forEach(finite);
  if (min > max) throw new RangeError('Minimum depth cannot exceed maximum depth.');
  return Math.min(max, Math.max(min, value));
}

export function clampVec3(point: Vec3, min: Vec3 | number, max: Vec3 | number): Vec3 {
  const lower = typeof min === 'number' ? { x: min, y: min, z: min } : min;
  const upper = typeof max === 'number' ? { x: max, y: max, z: max } : max;
  return {
    x: clampDepth(point.x, lower.x, upper.x),
    y: clampDepth(point.y, lower.y, upper.y),
    z: clampDepth(point.z, lower.z, upper.z),
  };
}

export interface CanvasBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function pointerToNdc(
  clientX: number,
  clientY: number,
  bounds: CanvasBounds,
): { x: number; y: number } {
  [clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height].forEach(finite);
  if (bounds.width <= 0 || bounds.height <= 0)
    throw new RangeError('Canvas must have positive dimensions.');
  return {
    x: clampDepth(((clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1),
    y: clampDepth(1 - ((clientY - bounds.top) / bounds.height) * 2, -1, 1),
  };
}

/** Limits total 3D travel distance, including diagonals. Worker applies its own bound too. */
export function boundedDragTarget(
  previous: Vec3,
  target: Vec3,
  maxSpeed: number,
  deltaSeconds: number,
): Vec3 {
  [
    previous.x,
    previous.y,
    previous.z,
    target.x,
    target.y,
    target.z,
    maxSpeed,
    deltaSeconds,
  ].forEach(finite);
  if (maxSpeed < 0 || deltaSeconds < 0)
    throw new RangeError('Drag speed and elapsed time cannot be negative.');
  const delta = { x: target.x - previous.x, y: target.y - previous.y, z: target.z - previous.z };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const maximum = maxSpeed * deltaSeconds;
  if (!Number.isFinite(distance) || !Number.isFinite(maximum))
    throw new RangeError('Drag movement exceeds numeric limits.');
  if (distance === 0 || distance <= maximum) return { ...target };
  const scale = maximum / distance;
  return {
    x: previous.x + delta.x * scale,
    y: previous.y + delta.y * scale,
    z: previous.z + delta.z * scale,
  };
}
