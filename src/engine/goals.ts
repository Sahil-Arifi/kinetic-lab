import type RAPIER from '@dimforge/rapier3d-compat';
import type { SceneDocument } from './scene-schema';

export interface GoalEvent { goalId: string; bodyId: string; tick: number }

/** Dwell is counted only in completed simulation ticks with an overlapping sensor. */
export class GoalTracker {
  private readonly dwell = new Map<string, number>();
  private readonly completed = new Set<string>();

  constructor(private readonly goals: SceneDocument['goals']) {}

  update(
    world: RAPIER.World,
    sensors: ReadonlyMap<string, RAPIER.Collider>,
    colliders: ReadonlyMap<string, RAPIER.Collider[]>,
    tick: number,
  ): GoalEvent[] {
    const events: GoalEvent[] = [];
    for (const goal of this.goals) {
      if (this.completed.has(goal.id)) continue;
      const sensor = sensors.get(goal.sensorBodyId);
      const targetColliders = colliders.get(goal.bodyId);
      const inside = sensor !== undefined && targetColliders !== undefined &&
        targetColliders.some((collider) => world.intersectionPair(sensor, collider));
      const ticks = inside ? (this.dwell.get(goal.id) ?? 0) + 1 : 0;
      this.dwell.set(goal.id, ticks);
      if (ticks >= goal.dwellTicks) {
        this.completed.add(goal.id);
        events.push({ goalId: goal.id, bodyId: goal.bodyId, tick });
      }
    }
    return events;
  }
}
