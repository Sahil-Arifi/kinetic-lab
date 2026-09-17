import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import { FixedClock } from '../src/engine/clock';
import { PhysicsWorld, eulerQuaternion, initPhysics, PHYSICS_DT } from '../src/engine/world';
import type { SceneDocument, Vec3 } from '../src/engine/scene-schema';
import { createMarbleRun } from '../src/scenes/marble-run';
import { primitive } from '../src/scenes/primitives';

await initPhysics();
const marbleRun = createMarbleRun();
const tolerances = {
  freeFallPositionMeters: 0.05,
  momentumVelocityMetersPerSecond: 0.00001,
  // Float32 accumulation at a 20 m origin: a 2 mm supplemental position bound.
  momentumPositionMeters: 0.002,
  resetAuthoredState: 0.000001,
  resetSnapshotDifference: 0,
  schedulingStateDifference: 0.000001,
  repeatedGoalTickDifference: 0,
};
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function isolated(): SceneDocument {
  return {
    schemaVersion: 1,
    id: 'isolated',
    name: 'Isolated sphere',
    seed: 2026,
    gravity: { x: 0, y: 0, z: 0 },
    bodies: [primitive('sphere', 'ball', { x: 0, y: 20, z: 0 })],
    goals: [],
  };
}
const fixtures = {
  marbleRun,
  isolated: isolated(),
  freeFall: { ticks: 120, gravity: { x: 0, y: -9.81, z: 0 } },
  momentum: { ticks: 240, velocity: { x: 1.5, y: -0.4, z: 0.7 } },
  reset: { repeats: 5, simulatedTicks: 90, impulse: { x: 3, y: 4, z: 1 } },
  scheduling: {
    durationMs: 6000,
    patternsMs: [[1000 / 60], [1000 / 144], [4, 12, 27, 7]],
    impulseTick: 120,
    gravityTick: 240,
  },
  repeatability: { repeats: 5, simulatedTicks: 1440 },
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const fall = new PhysicsWorld(isolated());
fall.setGravity(fixtures.freeFall.gravity);
for (let i = 0; i < fixtures.freeFall.ticks; i++) fall.step();
const fallTime = fixtures.freeFall.ticks * PHYSICS_DT;
const expectedY = 20 + 0.5 * fixtures.freeFall.gravity.y * fallTime ** 2;
const observedY = fall.bodies.get('ball')!.translation().y;
const fallError = Math.abs(observedY - expectedY);
assert(fallError <= tolerances.freeFallPositionMeters, `Free-fall error ${fallError}`);
fall.dispose();

const momentum = new PhysicsWorld(isolated());
const moving = momentum.bodies.get('ball')!;
moving.setLinvel(fixtures.momentum.velocity, true);
for (let i = 0; i < fixtures.momentum.ticks; i++) momentum.step();
const elapsed = fixtures.momentum.ticks * PHYSICS_DT;
const momentumVelocityError = distance(moving.linvel(), fixtures.momentum.velocity);
const momentumPositionError = distance(moving.translation(), {
  x: fixtures.momentum.velocity.x * elapsed,
  y: 20 + fixtures.momentum.velocity.y * elapsed,
  z: fixtures.momentum.velocity.z * elapsed,
});
assert(momentumVelocityError <= tolerances.momentumVelocityMetersPerSecond);
assert(momentumPositionError <= tolerances.momentumPositionMeters);
momentum.dispose();

const resetting = new PhysicsWorld(marbleRun);
const initial = resetting.snapshot();
let authoredError = 0,
  resetDifference = 0;
for (let run = 0; run < fixtures.reset.repeats; run++) {
  resetting.applyImpulse('marble', fixtures.reset.impulse);
  for (let i = 0; i < fixtures.reset.simulatedTicks; i++) resetting.step();
  resetting.beginGrab('marble', { x: 0, y: 5, z: 0 });
  resetting.reset();
  assert.equal(resetting.world.impulseJoints.len(), 0);
  assert.equal(resetting.world.bodies.len(), marbleRun.bodies.length);
  const resetState = resetting.snapshot();
  for (let i = 0; i < resetState.length; i++) {
    const actual = resetState[i]!,
      reference = initial[i]!,
      authored = marbleRun.bodies[i]!;
    const authoredRotation = eulerQuaternion(authored.rotation);
    authoredError = Math.max(
      authoredError,
      distance(actual.position, authored.position),
      ...(['x', 'y', 'z', 'w'] as const).map((axis) =>
        Math.abs(actual.rotation[axis] - authoredRotation[axis]),
      ),
    );
    resetDifference = Math.max(
      resetDifference,
      distance(actual.position, reference.position),
      ...(['x', 'y', 'z', 'w'] as const).map((axis) =>
        Math.abs(actual.rotation[axis] - reference.rotation[axis]),
      ),
    );
  }
}
assert(authoredError <= tolerances.resetAuthoredState);
assert(resetDifference <= tolerances.resetSnapshotDifference);
resetting.dispose();

function scheduled(pattern: number[]) {
  const physics = new PhysicsWorld(isolated());
  const clock = new FixedClock();
  let now = 0,
    index = 0;
  clock.advance(now, () => physics.step());
  while (now < fixtures.scheduling.durationMs) {
    now = Math.min(fixtures.scheduling.durationMs, now + pattern[index++ % pattern.length]!);
    clock.advance(now, () => {
      if (physics.tick === fixtures.scheduling.impulseTick)
        physics.applyImpulse('ball', { x: 3, y: 1, z: 0 });
      if (physics.tick === fixtures.scheduling.gravityTick)
        physics.setGravity({ x: 0, y: -1, z: 0 });
      physics.step();
    });
  }
  const result = {
    ticks: physics.tick,
    snapshot: physics.snapshot(),
    velocity: { ...physics.bodies.get('ball')!.linvel() },
    droppedTimeSeconds: clock.droppedTimeSeconds,
  };
  physics.dispose();
  return result;
}
const schedulingRuns = fixtures.scheduling.patternsMs.map(scheduled);
let schedulingError = 0;
for (const current of schedulingRuns) {
  assert.equal(current.ticks, 720);
  assert.equal(current.droppedTimeSeconds, 0);
  const reference = schedulingRuns[0]!;
  schedulingError = Math.max(
    schedulingError,
    distance(current.snapshot[0]!.position, reference.snapshot[0]!.position),
    distance(current.velocity, reference.velocity),
    ...(['x', 'y', 'z', 'w'] as const).map((axis) =>
      Math.abs(current.snapshot[0]!.rotation[axis] - reference.snapshot[0]!.rotation[axis]),
    ),
  );
}
assert(schedulingError <= tolerances.schedulingStateDifference);

const marble = new PhysicsWorld(marbleRun);
const marbleRuns = [];
for (let run = 0; run < fixtures.repeatability.repeats; run++) {
  marble.reset();
  const goalTicks: number[] = [];
  const contacts = new Set<string>();
  const maxDominoTilts = new Map<string, number>();
  for (let i = 0; i < fixtures.repeatability.simulatedTicks; i++) {
    const events = marble.step();
    goalTicks.push(...events.goals.map((event) => event.tick));
    for (const event of events.collisions)
      if (event.started) contacts.add([event.bodyA, event.bodyB].sort().join('|'));
    for (const [id, body] of marble.bodies)
      if (/^domino-\d+$/.test(id)) {
        maxDominoTilts.set(id, Math.max(maxDominoTilts.get(id) ?? 0, Math.abs(body.rotation().z)));
      }
  }
  assert.equal(goalTicks.length, 1);
  const rampContacts = [1, 2, 3].filter((ramp) => contacts.has(`marble|ramp-${ramp}`)).length;
  const adjacentDominoContacts = Array.from({ length: 9 }, (_, index) => index + 1).filter(
    (index) => contacts.has([`domino-${index}`, `domino-${index + 1}`].sort().join('|')),
  ).length;
  assert.equal(rampContacts, 3);
  assert.equal(adjacentDominoContacts, 9);
  assert((maxDominoTilts.get('domino-10') ?? 0) > 0.7);
  const position = { ...marble.bodies.get('marble')!.translation() };
  assert(position.x > 6.57 && position.x < 8.13);
  assert(position.y > 0.07 && position.y < 0.6);
  assert(Math.abs(position.z) < 0.78);
  marbleRuns.push({
    run: run + 1,
    goalTick: goalTicks[0]!,
    rampContacts,
    adjacentDominoContacts,
    finalMarblePosition: position,
  });
}
const goalTickSpread =
  Math.max(...marbleRuns.map((run) => run.goalTick)) -
  Math.min(...marbleRuns.map((run) => run.goalTick));
assert(goalTickSpread <= tolerances.repeatedGoalTickDifference);
marble.dispose();

const results = {
  scope:
    'Implementation validation of the recorded fixtures, not proof of general scientific accuracy or a performance benchmark.',
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    rapierVersion: RAPIER.version(),
  },
  timestepSeconds: PHYSICS_DT,
  solverIterations: 8,
  fixtureSha256: hash(fixtures),
  marbleRunSha256: hash(marbleRun),
  fixtures,
  tolerances,
  results: {
    freeFall: {
      durationSeconds: fallTime,
      expectedY,
      observedY,
      absoluteErrorMeters: fallError,
      pass: true,
    },
    zeroGravityMomentum: {
      durationSeconds: elapsed,
      velocityErrorMetersPerSecond: momentumVelocityError,
      positionErrorMeters: momentumPositionError,
      pass: true,
    },
    resetDeterminism: {
      repeats: fixtures.reset.repeats,
      bodiesComparedPerReset: initial.length,
      maxAuthoredStateError: authoredError,
      maxRepeatedSnapshotDifference: resetDifference,
      pass: true,
    },
    fixedTimestepIndependence: {
      patterns: ['60 Hz', '144 Hz', '4,12,27,7 ms'],
      ticksPerRun: 720,
      maxStateDifference: schedulingError,
      droppedTimeSeconds: 0,
      pass: true,
    },
    marbleRunRepeatability: {
      runs: marbleRuns,
      successes: marbleRuns.length,
      goalTickSpread,
      dwellTicks: marbleRun.goals[0]!.dwellTicks,
      pass: true,
    },
  },
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/physics-validation.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ ...results, fixtures: undefined }, null, 2));
