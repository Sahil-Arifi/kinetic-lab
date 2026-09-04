import { z } from 'zod';

export const finite = z.number().finite();
export const coordinate = finite.min(-100).max(100);
export const vec3Schema = z.strictObject({ x: coordinate, y: coordinate, z: coordinate });
export const idSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const labelSchema = z.string().min(1).max(80).regex(/^[\p{L}\p{N} .,'()_-]+$/u);
const dimension = finite.min(0.02).max(40);
export const bodyTypes = ['sphere', 'block', 'domino', 'ramp', 'fixedBarrier', 'targetCup'] as const;
export const bodySchema = z.strictObject({
  id: idSchema,
  name: labelSchema,
  type: z.enum(bodyTypes),
  position: vec3Schema,
  rotation: z.strictObject({ x: finite.min(-Math.PI * 2).max(Math.PI * 2), y: finite.min(-Math.PI * 2).max(Math.PI * 2), z: finite.min(-Math.PI * 2).max(Math.PI * 2) }),
  dimensions: z.strictObject({ x: dimension, y: dimension, z: dimension }),
  mass: finite.min(0).max(1000),
  friction: finite.min(0).max(2),
  restitution: finite.min(0).max(1),
  bodyMode: z.enum(['dynamic', 'fixed']),
}).superRefine((body, ctx) => {
  if (body.bodyMode === 'dynamic' && body.mass <= 0) ctx.addIssue({ code: 'custom', message: 'Dynamic bodies require positive mass', path: ['mass'] });
  if ((body.type === 'targetCup' || body.type === 'fixedBarrier') && body.bodyMode !== 'fixed') ctx.addIssue({ code: 'custom', message: 'Cups and barriers must be fixed', path: ['bodyMode'] });
  if (body.type === 'sphere' && (body.dimensions.x !== body.dimensions.y || body.dimensions.y !== body.dimensions.z)) ctx.addIssue({ code: 'custom', message: 'Sphere dimensions must be equal', path: ['dimensions'] });
  if (body.type === 'targetCup' && Math.min(body.dimensions.x, body.dimensions.y, body.dimensions.z) < 0.4) ctx.addIssue({ code: 'custom', message: 'Cup dimensions must be at least 0.4', path: ['dimensions'] });
});

export const sceneSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: labelSchema,
  seed: z.number().int().min(0).max(0xffffffff),
  gravity: vec3Schema,
  bodies: z.array(bodySchema).min(1).max(200),
  goals: z.array(z.strictObject({ id: idSchema, bodyId: idSchema, sensorBodyId: idSchema, dwellTicks: z.number().int().min(1).max(1200) })).max(20),
}).superRefine((scene, ctx) => {
  const bodies = new Map<string, (typeof scene.bodies)[number]>();
  for (const body of scene.bodies) {
    if (bodies.has(body.id)) ctx.addIssue({ code: 'custom', message: `Duplicate body ID: ${body.id}`, path: ['bodies'] });
    bodies.set(body.id, body);
  }
  const goals = new Set<string>();
  for (const goal of scene.goals) {
    if (goals.has(goal.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate goal ID', path: ['goals'] });
    goals.add(goal.id);
    if (bodies.get(goal.bodyId)?.bodyMode !== 'dynamic') ctx.addIssue({ code: 'custom', message: 'Goal body must reference a dynamic body', path: ['goals'] });
    if (bodies.get(goal.sensorBodyId)?.type !== 'targetCup') ctx.addIssue({ code: 'custom', message: 'Goal sensor must reference a target cup', path: ['goals'] });
  }
});

export type Vec3 = z.infer<typeof vec3Schema>;
export type BodyDocument = z.infer<typeof bodySchema>;
export type BodyType = BodyDocument['type'];
export type SceneDocument = z.infer<typeof sceneSchema>;
export function parseScene(input: unknown): SceneDocument { return sceneSchema.parse(input); }
export function parseSceneJson(json: string): SceneDocument {
  if (json.length > 1_000_000) throw new Error('Scene file exceeds 1 MB');
  return parseScene(JSON.parse(json) as unknown);
}
