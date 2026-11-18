import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Ray, Vector3 } from 'three';
import {
  createDragPlane,
  rayFromNormalizedCursor,
  updateDragDepth,
  updateDragFromRay,
} from '../../src/input/drag-plane';

function orthographicCamera() {
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

describe('shared pointer and hand ray-plane mapping', () => {
  it('preserves off-center grab offset and explicit camera-aligned depth', () => {
    const drag = createDragPlane(
      orthographicCamera(),
      new Vector3(1, 1, 0),
      new Vector3(0, 0, 0),
      0,
    );
    expect(drag.moved).toBe(false);
    const next = updateDragFromRay(
      drag,
      new Ray(new Vector3(2, 3, 10), new Vector3(0, 0, -1)),
      0,
    );
    expect(next?.toArray()).toEqual([1, 2, 0]);
    expect(drag.moved).toBe(true);
    expect(updateDragDepth(drag, 2).toArray()).toEqual([1, 2, -2]);
    expect(updateDragDepth(drag, 0).toArray()).toEqual([1, 2, 0]);
  });

  it('keeps the target unchanged for a parallel ray', () => {
    const drag = createDragPlane(
      orthographicCamera(),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      0,
    );
    const result = updateDragFromRay(
      drag,
      new Ray(new Vector3(1, 1, 10), new Vector3(1, 0, 0)),
      0,
    );
    expect(result).toBeNull();
    expect(drag.moved).toBe(false);
    expect(drag.target.toArray()).toEqual([0, 0, 0]);
  });

  it('maps normalized cursors to orthographic pointer event rays', () => {
    const camera = orthographicCamera();
    const center = rayFromNormalizedCursor(camera, { x: 0.5, y: 0.5 });
    expect(center.origin.x).toBeCloseTo(0);
    expect(center.origin.y).toBeCloseTo(0);
    expect(center.direction.toArray()).toEqual([0, 0, -1]);
    const topLeft = rayFromNormalizedCursor(camera, { x: 0, y: 0 });
    const bottomRight = rayFromNormalizedCursor(camera, { x: 1, y: 1 });
    expect(topLeft.origin.x).toBeCloseTo(-5);
    expect(topLeft.origin.y).toBeCloseTo(5);
    expect(bottomRight.origin.x).toBeCloseTo(5);
    expect(bottomRight.origin.y).toBeCloseTo(-5);
  });

  it('supports perspective camera rays without caller-specific formulas', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const center = rayFromNormalizedCursor(camera, { x: 0.5, y: 0.5 });
    expect(center.direction.z).toBeCloseTo(-1);
    const right = rayFromNormalizedCursor(camera, { x: 1, y: 0.5 });
    expect(right.direction.x).toBeGreaterThan(0);
  });

  it.each([
    { x: -0.01, y: 0.5 },
    { x: 1.01, y: 0.5 },
    { x: 0.5, y: -0.01 },
    { x: 0.5, y: 1.01 },
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ])('rejects invalid normalized cursor %j', (cursor) => {
    expect(() => rayFromNormalizedCursor(orthographicCamera(), cursor)).toThrow(RangeError);
  });
});
