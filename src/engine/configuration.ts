import { z } from 'zod';
import defaults from '../../configs/default.json';

export const configurationSchema = z.strictObject({
  physicsHz: z.literal(120),
  maxCatchUpSteps: z.literal(5),
  schedulerIntervalMs: z.number().int().min(1).max(50),
  snapshotHz: z.number().int().min(1).max(120),
  maxGrabSpeed: z.number().finite().positive().max(20),
  grabStiffness: z.number().finite().min(1).max(1000),
  grabDamping: z.number().finite().min(1).max(100),
  maxBodies: z.literal(200),
});
export const config = configurationSchema.parse(defaults);
export const FIXED_DT = 1 / config.physicsHz;
