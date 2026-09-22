import { z } from 'zod';
import { finite, idSchema, sceneSchema, vec3Schema } from './scene-schema';

export const PROTOCOL_VERSION = 1 as const;
const envelope = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1).max(100),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
};
export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('loadScene'), scene: sceneSchema }),
  z.strictObject({ type: z.literal('reset'), scene: sceneSchema }),
  z.strictObject({ type: z.literal('play') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('step') }),
  z.strictObject({ type: z.literal('setGravity'), gravity: vec3Schema }),
  z.strictObject({ type: z.literal('beginGrab'), bodyId: idSchema, target: vec3Schema }),
  z.strictObject({ type: z.literal('moveGrab'), target: vec3Schema }),
  z.strictObject({ type: z.literal('endGrab') }),
  z.strictObject({ type: z.literal('cancelGrab') }),
  z.strictObject({ type: z.literal('applyImpulse'), bodyId: idSchema, impulse: vec3Schema }),
]);
export const envelopeSchema = z.object(envelope);
const commandVariants = commandPayloadSchema.options.map((option) => option.extend(envelope));
export const commandSchema = z.discriminatedUnion('type', [
  commandVariants[0]!,
  ...commandVariants.slice(1),
]);
export type CommandPayload = z.infer<typeof commandPayloadSchema>;
export type WorkerCommand = CommandPayload & z.infer<typeof envelopeSchema>;
export const transformSchema = z.strictObject({
  id: idSchema,
  // A body may leave the authored bounds while falling: only finite output is required.
  position: z.strictObject({ x: finite, y: finite, z: finite }),
  rotation: z.strictObject({ x: finite, y: finite, z: finite, w: finite }),
  sleeping: z.boolean(),
});
export type Transform = z.infer<typeof transformSchema>;
const tick = z.number().int().nonnegative();
const responseVariants = [
  z.strictObject({ ...envelope, type: z.literal('ready') }),
  z.strictObject({
    ...envelope,
    type: z.literal('commandApplied'),
    command: z.enum([
      'loadScene',
      'reset',
      'play',
      'pause',
      'step',
      'setGravity',
      'beginGrab',
      'moveGrab',
      'endGrab',
      'cancelGrab',
      'applyImpulse',
    ]),
    tick,
    playing: z.boolean(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('transforms'),
    tick,
    bodies: z.array(transformSchema).max(200),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('collisionEvent'),
    bodyA: idSchema,
    bodyB: idSchema,
    started: z.boolean(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('goalEvent'),
    goalId: idSchema,
    bodyId: idSchema,
    tick,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('metrics'),
    tick,
    stepDurationMs: finite.nonnegative(),
    activeBodies: tick,
    sleepingBodies: tick,
    droppedTimeSeconds: finite.nonnegative(),
  }),
  z.strictObject({ ...envelope, type: z.literal('error'), message: z.string().max(500) }),
] as const;
export const responseSchema = z.discriminatedUnion('type', responseVariants);
export type WorkerResponse = z.infer<typeof responseSchema>;
export type ResponsePayload = WorkerResponse extends infer T
  ? T extends WorkerResponse
    ? Omit<T, keyof z.infer<typeof envelopeSchema>>
    : never
  : never;

/** A fresh session invalidates every queued response from the old world. */
export class ResponseGate {
  private lastSequence = 0;
  constructor(public sessionId: string) {}
  replace(sessionId: string): void {
    this.sessionId = sessionId;
    this.lastSequence = 0;
  }
  accept(input: unknown): WorkerResponse | undefined {
    const parsed = responseSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.sessionId !== this.sessionId ||
      parsed.data.sequence <= this.lastSequence
    )
      return undefined;
    this.lastSequence = parsed.data.sequence;
    return parsed.data;
  }
}

/** Session transitions require an explicit world reconstruction command. */
export class CommandGate {
  private sessionId: string | undefined;
  private lastSequence = 0;
  private retired = new Set<string>();
  accept(input: unknown): WorkerCommand | undefined {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return undefined;
    const message = parsed.data;
    if (this.retired.has(message.sessionId)) return undefined;
    if (message.sessionId !== this.sessionId) {
      if (message.type !== 'loadScene' && message.type !== 'reset') return undefined;
      if (this.sessionId !== undefined) this.retired.add(this.sessionId);
      this.sessionId = message.sessionId;
      this.lastSequence = 0;
    }
    if (message.sequence <= this.lastSequence) return undefined;
    this.lastSequence = message.sequence;
    return message;
  }
}
