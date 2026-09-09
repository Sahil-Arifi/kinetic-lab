import { parseScene, type BodyDocument, type SceneDocument, type Vec3 } from '../engine/scene-schema';

type BodyType = BodyDocument['type'];
export type BodyPatch = Partial<Omit<BodyDocument, 'id' | 'type'>>;

function nextId(scene: SceneDocument, stem: string): string {
  const used = new Set(scene.bodies.map((body) => body.id));
  let suffix = 1;
  const candidate = () => `${stem.slice(0, 63 - String(suffix).length)}-${suffix}`;
  while (used.has(candidate())) suffix += 1;
  return candidate();
}

function requireBody(scene: SceneDocument, id: string): BodyDocument {
  const body = scene.bodies.find((candidate) => candidate.id === id);
  if (!body) throw new Error(`Object "${id}" does not exist.`);
  return body;
}

export function editBody(scene: SceneDocument, id: string, patch: BodyPatch): SceneDocument {
  const current = parseScene(scene);
  const body = requireBody(current, id);
  return parseScene({
    ...current,
    bodies: current.bodies.map((candidate) =>
      candidate.id === id ? { ...body, ...patch, id: body.id, type: body.type } : candidate,
    ),
  });
}

/** IDs are derived from document contents, never time or randomness. */
export function addBody(scene: SceneDocument, type: BodyType): SceneDocument {
  const current = parseScene(scene);
  const dimensions: Record<BodyType, Vec3> = {
    sphere: { x: 0.5, y: 0.5, z: 0.5 },
    block: { x: 0.7, y: 0.7, z: 0.7 },
    domino: { x: 0.15, y: 0.9, z: 0.4 },
    ramp: { x: 2.5, y: 0.15, z: 0.8 },
    fixedBarrier: { x: 2, y: 0.4, z: 0.15 },
    targetCup: { x: 1.2, y: 0.5, z: 1.2 },
  };
  const labels: Record<BodyType, string> = {
    sphere: 'Marble', block: 'Block', domino: 'Domino', ramp: 'Ramp',
    fixedBarrier: 'Barrier', targetCup: 'Target cup',
  };
  const body: BodyDocument = {
    id: nextId(current, type),
    name: labels[type],
    type,
    position: { x: 0, y: 3, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: dimensions[type],
    mass: 1,
    friction: 0.5,
    restitution: 0.1,
    bodyMode: type === 'ramp' || type === 'fixedBarrier' || type === 'targetCup' ? 'fixed' : 'dynamic',
  };
  return parseScene({ ...current, bodies: [...current.bodies, body] });
}

export function duplicateBody(scene: SceneDocument, id: string): SceneDocument {
  const current = parseScene(scene);
  const body = requireBody(current, id);
  const duplicate: BodyDocument = {
    ...body,
    id: nextId(current, `${id}-copy`),
    name: `${body.name.slice(0, 75)} copy`,
    position: { ...body.position, x: Math.min(100, body.position.x + body.dimensions.x + 0.2) },
  };
  return parseScene({ ...current, bodies: [...current.bodies, duplicate] });
}

export function deleteBody(scene: SceneDocument, id: string): SceneDocument {
  const current = parseScene(scene);
  requireBody(current, id);
  return parseScene({
    ...current,
    bodies: current.bodies.filter((body) => body.id !== id),
    goals: current.goals.filter((goal) => goal.bodyId !== id && goal.sensorBodyId !== id),
  });
}

export function setSceneGravity(scene: SceneDocument, gravity: Vec3): SceneDocument {
  return parseScene({ ...parseScene(scene), gravity });
}
