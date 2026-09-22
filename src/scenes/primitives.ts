import type { BodyDocument, Vec3 } from '../engine/scene-schema';

/** Full extents in metres; target cups use a low entry lip on their negative X side. */
export const CUP_WALL_THICKNESS = 0.12;

export function primitive(
  type: BodyDocument['type'],
  id: string,
  position: Vec3,
  overrides: Partial<Omit<BodyDocument, 'id' | 'type' | 'position'>> = {},
): BodyDocument {
  const dimensions: Record<BodyDocument['type'], Vec3> = {
    sphere: { x: 0.48, y: 0.48, z: 0.48 },
    block: { x: 0.8, y: 0.8, z: 0.8 },
    domino: { x: 0.16, y: 0.9, z: 0.75 },
    ramp: { x: 3, y: 0.2, z: 1.2 },
    fixedBarrier: { x: 1, y: 0.8, z: 0.15 },
    targetCup: { x: 1.8, y: 1.5, z: 1.8 },
  };
  const fixed = type === 'ramp' || type === 'fixedBarrier' || type === 'targetCup';
  return {
    id,
    name: type === 'targetCup' ? 'Target cup' : type[0]!.toUpperCase() + type.slice(1),
    type,
    position,
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: dimensions[type],
    mass: type === 'sphere' ? 3 : type === 'domino' ? 0.12 : 1,
    friction: type === 'sphere' ? 0.28 : 0.5,
    restitution: 0.05,
    bodyMode: fixed ? 'fixed' : 'dynamic',
    ...overrides,
  };
}
