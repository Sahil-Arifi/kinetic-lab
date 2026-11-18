import { Plane, Ray, Raycaster, Vector2, Vector3, type Camera } from 'three';

/**
 * Shared camera-facing drag plane for pointer manipulation and future hand rays.
 * Off-center hit offsets prevent the object from snapping to the cursor.
 * The Rapier worker retains exclusive ownership of physics constraints.
 */
export interface DragPlane {
  plane: Plane;
  offset: Vector3;
  normal: Vector3;
  base: Vector3;
  target: Vector3;
  startDepth: number;
  moved: boolean;
}

export function createDragPlane(
  camera: Camera,
  hit: Vector3,
  center: Vector3,
  startDepth: number,
): DragPlane {
  const normal = camera.getWorldDirection(new Vector3());
  return {
    plane: new Plane().setFromNormalAndCoplanarPoint(normal, hit),
    offset: hit.clone().sub(center),
    normal,
    base: center.clone(),
    target: center.clone(),
    startDepth,
    moved: false,
  };
}

/** Reapply depth using the last projected ray hit, not a new physical grab. */
export function updateDragDepth(drag: DragPlane, depth: number): Vector3 {
  drag.target.copy(drag.base).addScaledVector(drag.normal, depth - drag.startDepth);
  drag.moved = true;
  return drag.target;
}

/** An unprojectable ray must not move the dragged object. */
export function updateDragFromRay(drag: DragPlane, ray: Ray, depth: number): Vector3 | null {
  const hit = ray.intersectPlane(drag.plane, new Vector3());
  if (!hit) return null;
  drag.base.copy(hit).sub(drag.offset);
  return updateDragDepth(drag, depth);
}

/**
 * Normalized coordinates have a top-left origin. Mirroring happens once in the
 * landmark adapter, so it must never be repeated here.
 */
export function rayFromNormalizedCursor(camera: Camera, cursor: { x: number; y: number }): Ray {
  if (
    !Number.isFinite(cursor.x) ||
    !Number.isFinite(cursor.y) ||
    cursor.x < 0 ||
    cursor.x > 1 ||
    cursor.y < 0 ||
    cursor.y > 1
  ) {
    throw new RangeError('Hand cursor must be finite and within normalized image bounds.');
  }
  const caster = new Raycaster();
  caster.setFromCamera(new Vector2(cursor.x * 2 - 1, 1 - cursor.y * 2), camera);
  return caster.ray.clone();
}
