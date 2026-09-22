import type { SceneDocument } from '../../src/engine/scene-schema';

export const minimalScene: SceneDocument = {
  schemaVersion: 1,
  id: 'test-scene',
  name: 'Test scene',
  seed: 1,
  gravity: { x: 0, y: -9.81, z: 0 },
  bodies: [
    {
      id: 'ball',
      name: 'Ball',
      type: 'sphere',
      position: { x: 0, y: 4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      dimensions: { x: 0.5, y: 0.5, z: 0.5 },
      mass: 1,
      friction: 0.5,
      restitution: 0.2,
      bodyMode: 'dynamic',
    },
  ],
  goals: [],
};
