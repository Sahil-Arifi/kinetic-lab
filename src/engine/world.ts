import RAPIER from '@dimforge/rapier3d-compat';
import { sceneSchema, type BodyDocument, type SceneDocument, type Vec3 } from './scene-schema';
import { GrabConstraint } from './drag';
import { GoalTracker, type GoalEvent } from './goals';
import { CUP_WALL_THICKNESS } from '../scenes/primitives';
import { FIXED_DT } from './configuration';
import type { Transform } from './protocol';

export const PHYSICS_DT = FIXED_DT;
export type { Transform } from './protocol';
export interface CollisionEvent {
  bodyA: string;
  bodyB: string;
  started: boolean;
}

let initialization: Promise<void> | undefined;
export function initPhysics(): Promise<void> {
  return (initialization ??= RAPIER.init());
}

export function eulerQuaternion(rotation: Vec3): Transform['rotation'] {
  const cx = Math.cos(rotation.x / 2),
    sx = Math.sin(rotation.x / 2);
  const cy = Math.cos(rotation.y / 2),
    sy = Math.sin(rotation.y / 2);
  const cz = Math.cos(rotation.z / 2),
    sz = Math.sin(rotation.z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

/** Instantiated by the worker in the application, and directly by real Rapier tests. */
export class PhysicsWorld {
  world!: RAPIER.World;
  readonly bodies = new Map<string, RAPIER.RigidBody>();
  readonly colliders = new Map<string, RAPIER.Collider[]>();
  readonly sensors = new Map<string, RAPIER.Collider>();
  tick = 0;
  private scene: SceneDocument;
  private queue!: RAPIER.EventQueue;
  private grab!: GrabConstraint;
  private goals!: GoalTracker;
  private readonly colliderIds = new Map<number, string>();
  private disposed = false;

  constructor(scene: SceneDocument) {
    this.scene = sceneSchema.parse(scene);
    this.construct();
  }

  private construct(): void {
    this.world = new RAPIER.World(this.scene.gravity);
    this.world.timestep = PHYSICS_DT;
    this.world.numSolverIterations = 8;
    this.queue = new RAPIER.EventQueue(true);
    this.grab = new GrabConstraint(this.world);
    this.goals = new GoalTracker(this.scene.goals);
    this.tick = 0;
    this.disposed = false;
    for (const body of this.scene.bodies) this.addBody(body);
  }

  private addBody(document: BodyDocument): void {
    const p = document.position;
    const descriptor =
      document.bodyMode === 'dynamic'
        ? RAPIER.RigidBodyDesc.dynamic()
        : RAPIER.RigidBodyDesc.fixed();
    descriptor.setTranslation(p.x, p.y, p.z).setRotation(eulerQuaternion(document.rotation));
    descriptor.setCcdEnabled(document.bodyMode === 'dynamic');
    const body = this.world.createRigidBody(descriptor);
    this.bodies.set(document.id, body);
    const colliderList: RAPIER.Collider[] = [];
    const add = (desc: RAPIER.ColliderDesc, sensor = false): RAPIER.Collider => {
      desc
        .setFriction(document.friction)
        .setRestitution(document.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (sensor) desc.setSensor(true).setDensity(0);
      else desc.setMass(document.mass);
      const collider = this.world.createCollider(desc, body);
      this.colliderIds.set(collider.handle, document.id);
      if (!sensor) colliderList.push(collider);
      return collider;
    };
    const d = document.dimensions;
    if (document.type === 'sphere') {
      add(RAPIER.ColliderDesc.ball(d.x / 2));
    } else if (document.type === 'targetCup') {
      const wall = Math.min(CUP_WALL_THICKNESS, d.x / 5, d.y / 5, d.z / 5);
      add(
        RAPIER.ColliderDesc.cuboid(d.x / 2, wall / 2, d.z / 2).setTranslation(
          0,
          -d.y / 2 + wall / 2,
          0,
        ),
      );
      for (const side of [-1, 1]) {
        add(
          RAPIER.ColliderDesc.cuboid(d.x / 2, d.y / 2, wall / 2).setTranslation(
            0,
            0,
            (side * (d.z - wall)) / 2,
          ),
        );
      }
      add(
        RAPIER.ColliderDesc.cuboid(wall / 2, d.y / 2, (d.z - 2 * wall) / 2).setTranslation(
          (d.x - wall) / 2,
          0,
          0,
        ),
      );
      add(
        RAPIER.ColliderDesc.cuboid(wall / 2, d.y * 0.1, (d.z - 2 * wall) / 2).setTranslation(
          -(d.x - wall) / 2,
          -d.y * 0.4,
          0,
        ),
      );
      const sensor = add(
        RAPIER.ColliderDesc.cuboid(
          (d.x - 2 * wall) / 2,
          (d.y - 2 * wall) / 2,
          (d.z - 2 * wall) / 2,
        ).setTranslation(0, wall / 4, 0),
        true,
      );
      this.sensors.set(document.id, sensor);
    } else {
      add(RAPIER.ColliderDesc.cuboid(d.x / 2, d.y / 2, d.z / 2));
    }
    this.colliders.set(document.id, colliderList);
  }

  step(): { collisions: CollisionEvent[]; goals: GoalEvent[] } {
    this.grab.step(PHYSICS_DT);
    this.world.step(this.queue);
    this.tick += 1;
    const collisions: CollisionEvent[] = [];
    this.queue.drainCollisionEvents((a, b, started) => {
      const bodyA = this.colliderIds.get(a);
      const bodyB = this.colliderIds.get(b);
      if (bodyA !== undefined && bodyB !== undefined && bodyA !== bodyB) {
        collisions.push({ bodyA, bodyB, started });
      }
    });
    return {
      collisions,
      goals: this.goals.update(this.world, this.sensors, this.colliders, this.tick),
    };
  }

  snapshot(): Transform[] {
    return [...this.bodies].map(([id, body]) => ({
      id,
      position: { ...body.translation() },
      rotation: { ...body.rotation() },
      sleeping: body.isSleeping(),
    }));
  }

  metrics(): { activeBodies: number; sleepingBodies: number } {
    let activeBodies = 0,
      sleepingBodies = 0;
    for (const body of this.bodies.values()) {
      if (!body.isDynamic()) continue;
      if (body.isSleeping()) sleepingBodies += 1;
      else activeBodies += 1;
    }
    return { activeBodies, sleepingBodies };
  }

  setGravity(gravity: Vec3): void {
    this.world.gravity = { ...gravity };
    this.bodies.forEach((body) => {
      if (body.isDynamic()) body.wakeUp();
    });
  }

  beginGrab(id: string, target: Vec3): boolean {
    const body = this.bodies.get(id);
    return body !== undefined && this.grab.begin(body, target);
  }

  moveGrab(target: Vec3): void {
    this.grab.move(target);
  }
  endGrab(): void {
    this.grab.end();
  }

  applyImpulse(id: string, impulse: Vec3): boolean {
    const body = this.bodies.get(id);
    if (!body?.isDynamic()) return false;
    body.applyImpulse(impulse, true);
    return true;
  }

  reset(scene: SceneDocument = this.scene): void {
    const validated = sceneSchema.parse(scene);
    this.dispose();
    this.scene = validated;
    this.construct();
  }

  dispose(): void {
    if (this.disposed) return;
    this.grab.end();
    this.queue.free();
    this.world.free();
    this.bodies.clear();
    this.colliders.clear();
    this.sensors.clear();
    this.colliderIds.clear();
    this.disposed = true;
  }
}
