import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, eulerQuaternion, initPhysics, PHYSICS_DT } from '../../src/engine/world';
import { GrabConstraint, MAX_HANDLE_SPEED } from '../../src/engine/drag';
import { GoalTracker } from '../../src/engine/goals';
import { FixedClock } from '../../src/engine/clock';
import { createMarbleRun } from '../../src/scenes/marble-run';
import { primitive } from '../../src/scenes/primitives';
import type { SceneDocument } from '../../src/engine/scene-schema';

const worlds: PhysicsWorld[] = [];
const zero = { x: 0, y: 0, z: 0 };
function isolated(): SceneDocument {
  return {
    schemaVersion: 1,
    id: 'experiment',
    name: 'Experiment',
    seed: 1,
    gravity: zero,
    bodies: [primitive('sphere', 'ball', { x: 0, y: 10, z: 0 })],
    goals: [],
  };
}
function world(scene = isolated()): PhysicsWorld {
  const result = new PhysicsWorld(scene);
  worlds.push(result);
  return result;
}
beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  worlds.splice(0).forEach((item) => item.dispose());
});

describe('real Rapier world', () => {
  it('builds every authored primitive, solid cup walls, and a real sensor', () => {
    const scene = createMarbleRun();
    const physics = world(scene);
    expect(physics.bodies.size).toBe(scene.bodies.length);
    expect(physics.sensors.get('target-cup')!.isSensor()).toBe(true);
    expect(physics.colliders.get('target-cup')).toHaveLength(5);
    expect(physics.metrics()).toEqual({ activeBodies: 11, sleepingBodies: 0 });
    expect(physics.world.timestep).toBeCloseTo(PHYSICS_DT, 8);
    for (const body of scene.bodies) {
      const state = physics.snapshot().find((item) => item.id === body.id)!;
      expect(state.position.x).toBeCloseTo(body.position.x, 5);
      expect(state.position.y).toBeCloseTo(body.position.y, 5);
      expect(state.position.z).toBeCloseTo(body.position.z, 5);
    }
  });

  it('matches analytic free fall within the documented 5 cm tolerance after one second', () => {
    const physics = world();
    physics.setGravity({ x: 0, y: -9.81, z: 0 });
    for (let i = 0; i < 120; i++) physics.step();
    expect(physics.tick).toBe(120);
    expect(Math.abs(physics.bodies.get('ball')!.translation().y - (10 - 4.905))).toBeLessThan(0.05);
  });

  it('preserves isolated momentum with zero gravity and zero damping', () => {
    const physics = world();
    const body = physics.bodies.get('ball')!;
    const velocity = { x: 1.5, y: -0.4, z: 0.7 };
    body.setLinvel(velocity, true);
    for (let i = 0; i < 240; i++) physics.step();
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(body.linvel()[axis]).toBeCloseTo(velocity[axis], 6);
    }
    expect(body.translation().x).toBeCloseTo(3, 4);
  });

  it('processes real started/stopped collision events and wakes sleeping bodies on gravity change', () => {
    const scene = isolated();
    scene.gravity = { x: 0, y: -9.81, z: 0 };
    scene.bodies[0]!.position.y = 1;
    scene.bodies.push(
      primitive('block', 'floor', zero, { bodyMode: 'fixed', dimensions: { x: 5, y: 0.2, z: 5 } }),
    );
    const physics = world(scene);
    const events = [];
    for (let i = 0; i < 600; i++) events.push(...physics.step().collisions);
    expect(
      events.some((event) => event.started && [event.bodyA, event.bodyB].includes('ball')),
    ).toBe(true);
    expect(physics.metrics()).toEqual({ activeBodies: 0, sleepingBodies: 1 });
    physics.setGravity({ x: 0, y: 9.81, z: 0 });
    expect(physics.metrics()).toEqual({ activeBodies: 1, sleepingBodies: 0 });
    for (let i = 0; i < 60; i++) events.push(...physics.step().collisions);
    expect(events.some((event) => !event.started)).toBe(true);
    expect(physics.bodies.get('ball')!.translation().y).toBeGreaterThan(1);
  });

  it('applies impulses only to dynamic authored bodies', () => {
    const physics = world(createMarbleRun());
    expect(physics.applyImpulse('missing', { x: 1, y: 0, z: 0 })).toBe(false);
    expect(physics.applyImpulse('ramp-1', { x: 1, y: 0, z: 0 })).toBe(false);
    expect(physics.applyImpulse('marble', { x: 3, y: 0, z: 0 })).toBe(true);
    expect(physics.bodies.get('marble')!.linvel().x).toBeCloseTo(1, 6);
  });

  it('reconstructs identical initial state through repeated resets, including a live grab', () => {
    const scene = createMarbleRun();
    const physics = world(scene);
    const initial = physics.snapshot();
    for (let repeat = 0; repeat < 5; repeat++) {
      physics.applyImpulse('marble', { x: repeat + 1, y: 4, z: 1 });
      for (let i = 0; i < 70; i++) physics.step();
      physics.beginGrab('marble', { x: 0, y: 3, z: 0 });
      physics.reset();
      expect(physics.tick).toBe(0);
      expect(physics.snapshot()).toEqual(initial);
      expect(physics.world.bodies.len()).toBe(scene.bodies.length);
      expect(physics.world.impulseJoints.len()).toBe(0);
      for (const body of physics.bodies.values()) {
        expect(body.linvel()).toEqual(zero);
        expect(body.angvel()).toEqual(zero);
      }
    }
  });

  it('validates scene replacement before destroying a working world', () => {
    const physics = world();
    expect(() => physics.reset({ ...isolated(), bodies: [] })).toThrow();
    expect(physics.bodies.has('ball')).toBe(true);
    physics.reset(createMarbleRun());
    expect(physics.bodies.has('ball')).toBe(false);
    expect(physics.bodies.has('marble')).toBe(true);
    physics.dispose();
    physics.dispose();
    expect(physics.bodies.size).toBe(0);
  });

  it('produces equivalent physical outcomes under different render scheduling patterns', () => {
    function run(pattern: number[]) {
      const physics = world();
      const clock = new FixedClock();
      let now = 0,
        index = 0;
      clock.advance(now, () => physics.step());
      while (now < 3000) {
        now = Math.min(3000, now + pattern[index++ % pattern.length]!);
        clock.advance(now, () => {
          if (physics.tick === 120) physics.applyImpulse('ball', { x: 3, y: 1, z: 0 });
          if (physics.tick === 240) physics.setGravity({ x: 0, y: -1, z: 0 });
          physics.step();
        });
      }
      expect(physics.tick).toBe(360);
      expect(clock.droppedTimeSeconds).toBe(0);
      return physics.snapshot();
    }
    expect(run([1000 / 60])).toEqual(run([1000 / 144]));
    expect(run([4, 12, 27, 7])).toEqual(run([1000 / 60]));
  });

  it('executes all ramps, nine domino contacts and the goal on every reset', () => {
    const physics = world(createMarbleRun());
    const completionTicks: number[] = [];
    for (let run = 0; run < 5; run++) {
      physics.reset();
      const contacts = new Set<string>();
      const goals = [];
      let lastDominoTilt = 0;
      for (let i = 0; i < 1200; i++) {
        const events = physics.step();
        events.collisions
          .filter((event) => event.started)
          .forEach((event) => contacts.add([event.bodyA, event.bodyB].sort().join('|')));
        goals.push(...events.goals);
        lastDominoTilt = Math.max(
          lastDominoTilt,
          Math.abs(physics.bodies.get('domino-10')!.rotation().z),
        );
      }
      expect(goals).toHaveLength(1);
      completionTicks.push(goals[0]!.tick);
      for (let ramp = 1; ramp <= 3; ramp++) expect(contacts.has(`marble|ramp-${ramp}`)).toBe(true);
      for (let domino = 1; domino < 10; domino++)
        expect(contacts.has([`domino-${domino}`, `domino-${domino + 1}`].sort().join('|'))).toBe(
          true,
        );
      expect(lastDominoTilt).toBeGreaterThan(0.7);
      const marble = physics.bodies.get('marble')!.translation();
      expect(marble.x).toBeGreaterThan(6.57);
      expect(marble.x).toBeLessThan(8.13);
      expect(marble.y).toBeLessThan(0.6);
      expect(marble.y).toBeGreaterThan(0.07);
      expect(Math.abs(marble.z)).toBeLessThan(0.78);
    }
    expect(new Set(completionTicks).size).toBe(1);
  });
});

describe('damped spring grabbing', () => {
  it('creates a collider-free kinematic handle, bounds its speed, and never teleports the body', () => {
    const physics = world();
    const body = physics.bodies.get('ball')!;
    expect(physics.beginGrab('missing', zero)).toBe(false);
    expect(physics.beginGrab('ball', body.translation())).toBe(true);
    let handle: RAPIER.RigidBody | undefined;
    physics.world.bodies.forEach((item) => {
      if (item.isKinematic()) handle = item;
    });
    expect(handle!.numColliders()).toBe(0);
    expect(physics.world.impulseJoints.len()).toBe(1);
    physics.moveGrab({ x: 50, y: 10, z: 0 });
    expect(body.translation().x).toBe(0);
    physics.step();
    expect(handle!.translation().x).toBeCloseTo(MAX_HANDLE_SPEED * PHYSICS_DT, 6);
    expect(body.translation().x).toBeLessThan(1);
    for (let i = 0; i < 20; i++) physics.step();
    expect(body.translation().x).toBeGreaterThan(0.05);
    const velocityBeforeRelease = { ...body.linvel() };
    physics.endGrab();
    expect(physics.world.bodies.len()).toBe(1);
    expect(physics.world.impulseJoints.len()).toBe(0);
    expect(body.linvel()).toEqual(velocityBeforeRelease);
    physics.endGrab();
    physics.moveGrab(zero);
    physics.step();
  });

  it('replaces a grab safely and rejects fixed bodies without leaving a handle', () => {
    const physics = world(createMarbleRun());
    expect(physics.beginGrab('marble', physics.bodies.get('marble')!.translation())).toBe(true);
    expect(physics.beginGrab('domino-1', physics.bodies.get('domino-1')!.translation())).toBe(true);
    expect(physics.world.impulseJoints.len()).toBe(1);
    expect(physics.beginGrab('workbench', zero)).toBe(false);
    expect(physics.world.impulseJoints.len()).toBe(0);
    expect(physics.world.bodies.len()).toBe(physics.bodies.size);
  });

  it('preserves an off-center local anchor under rotation and handles an unmoved target', () => {
    const scene = isolated();
    scene.bodies[0]!.rotation = { x: 0.2, y: 0.3, z: Math.PI / 2 };
    const physics = world(scene);
    const body = physics.bodies.get('ball')!;
    const grab = new GrabConstraint(physics.world);
    expect(grab.active).toBe(false);
    const target = { x: 0.2, y: 10, z: 0 };
    grab.begin(body, target);
    expect(grab.active).toBe(true);
    grab.step(PHYSICS_DT);
    physics.world.step();
    expect(body.translation().x).toBeCloseTo(0, 6);
    expect(body.translation().y).toBeCloseTo(10, 6);
    grab.end();
    expect(grab.active).toBe(false);
    expect(eulerQuaternion(zero)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('sensor dwell', () => {
  it('requires consecutive physics ticks and emits only once per reconstructed world', () => {
    const scene = isolated();
    scene.bodies[0]!.position = { x: 0, y: 0.5, z: 0 };
    scene.bodies.push(primitive('targetCup', 'cup', { x: 0, y: 0.5, z: 0 }));
    scene.goals = [{ id: 'inside', bodyId: 'ball', sensorBodyId: 'cup', dwellTicks: 4 }];
    const physics = world(scene);
    expect(physics.step().goals).toEqual([]);
    expect(physics.step().goals).toEqual([]);
    physics.bodies.get('ball')!.setTranslation({ x: 5, y: 5, z: 0 }, true);
    expect(physics.step().goals).toEqual([]);
    physics.bodies.get('ball')!.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
    for (let i = 0; i < 3; i++) expect(physics.step().goals).toEqual([]);
    expect(physics.step().goals).toEqual([{ goalId: 'inside', bodyId: 'ball', tick: 7 }]);
    for (let i = 0; i < 4; i++) expect(physics.step().goals).toEqual([]);
    const tracker = new GoalTracker(scene.goals);
    expect(tracker.update(physics.world, new Map(), physics.colliders, 8)).toEqual([]);
    expect(tracker.update(physics.world, physics.sensors, new Map(), 8)).toEqual([]);
  });
});
