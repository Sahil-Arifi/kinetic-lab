import { sceneSchema, type SceneDocument } from '../engine/scene-schema';
import { primitive } from './primitives';

export const MARBLE_RUN_DWELL_TICKS = 45;

/** All geometry is authored in this document; no runtime nudges or scripted forces. */
export function createMarbleRun(): SceneDocument {
  const slope = -0.2;
  const length = 3;
  const dx = length * Math.cos(slope);
  const dy = length * Math.sin(slope);
  const ramps = Array.from({ length: 3 }, (_, index) =>
    primitive(
      'ramp',
      `ramp-${index + 1}`,
      { x: -5 + index * dx, y: 2.35 + index * dy, z: 0 },
      {
        name: `Ramp ${index + 1}`,
        rotation: { x: 0, y: 0, z: slope },
        dimensions: { x: length + 0.04, y: 0.2, z: 1.2 },
      },
    ),
  );
  return sceneSchema.parse({
    schemaVersion: 1,
    id: 'marble-run',
    name: 'The cascade',
    seed: 2026,
    gravity: { x: 0, y: -9.81, z: 0 },
    bodies: [
      primitive(
        'block',
        'workbench',
        { x: 0.5, y: -0.25, z: 0 },
        {
          name: 'Workbench',
          dimensions: { x: 19, y: 0.3, z: 5 },
          bodyMode: 'fixed',
        },
      ),
      ...ramps,
      ...ramps.flatMap((ramp, index) =>
        [-1, 1].map((side) =>
          primitive(
            'fixedBarrier',
            `rail-${index + 1}-${side < 0 ? 'near' : 'far'}`,
            {
              x: ramp.position.x,
              y: ramp.position.y + 0.18,
              z: side * 0.61,
            },
            {
              name: `Ramp ${index + 1} rail`,
              rotation: ramp.rotation,
              dimensions: { x: length + 0.06, y: 0.4, z: 0.1 },
            },
          ),
        ),
      ),
      primitive('sphere', 'marble', { x: -6.15, y: 2.98, z: 0 }, { name: 'Marble' }),
      primitive(
        'block',
        'domino-stage',
        { x: 4.25, y: 0.59, z: 0 },
        {
          name: 'Domino stage',
          dimensions: { x: 4.7, y: 0.24, z: 1.3 },
          bodyMode: 'fixed',
          rotation: { x: 0, y: 0, z: -0.08 },
        },
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        primitive(
          'domino',
          `domino-${index + 1}`,
          {
            x: 2.7 + index * 0.32,
            y: 1.06 - (2.7 + index * 0.32 - 4.25) * Math.tan(0.08),
            z: 0.25,
          },
          {
            name: `Domino ${String(index + 1).padStart(2, '0')}`,
            dimensions: { x: 0.1, y: 0.7, z: 0.28 },
            rotation: { x: 0, y: 0, z: -0.08 },
            friction: 1.2,
          },
        ),
      ),
      primitive(
        'fixedBarrier',
        'stage-near',
        { x: 4.2, y: 1, z: -0.72 },
        {
          name: 'Front safety rail',
          dimensions: { x: 4.8, y: 0.6, z: 0.1 },
        },
      ),
      primitive(
        'fixedBarrier',
        'stage-far',
        { x: 4.2, y: 1, z: 0.72 },
        {
          name: 'Back safety rail',
          dimensions: { x: 4.8, y: 0.6, z: 0.1 },
        },
      ),
      primitive(
        'targetCup',
        'target-cup',
        { x: 7.35, y: 0.7, z: 0 },
        {
          name: 'Finish cup',
          restitution: 0,
        },
      ),
      // Posts meet the underside of each slab without reaching its rolling surface.
      // Appending them preserves the construction order of the experiment bodies.
      ...ramps.map((ramp, index) => {
        const top = ramp.position.y - 0.08;
        const base = -0.1;
        return primitive(
          'block',
          `ramp-support-${index + 1}`,
          {
            x: ramp.position.x,
            y: (top + base) / 2,
            z: 0,
          },
          {
            name: `Ramp ${index + 1} support`,
            bodyMode: 'fixed',
            dimensions: { x: 0.4, y: top - base, z: 0.8 },
          },
        );
      }),
      ...[3, 5.5].map((x, index) => {
        const top = 0.59 - (x - 4.25) * Math.tan(0.08) - 0.1;
        const base = -0.1;
        return primitive(
          'block',
          `stage-support-${index + 1}`,
          {
            x,
            y: (top + base) / 2,
            z: 0,
          },
          {
            name: `Stage support ${index + 1}`,
            bodyMode: 'fixed',
            dimensions: { x: 0.4, y: top - base, z: 0.8 },
          },
        );
      }),
    ],
    goals: [
      {
        id: 'marble-home',
        bodyId: 'marble',
        sensorBodyId: 'target-cup',
        dwellTicks: MARBLE_RUN_DWELL_TICKS,
      },
    ],
  });
}

export const marbleRun = createMarbleRun();
