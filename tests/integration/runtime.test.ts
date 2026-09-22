import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PhysicsRuntime } from '../../src/engine/commands';
import type { CommandPayload, WorkerResponse } from '../../src/engine/protocol';
import { initPhysics } from '../../src/engine/world';
import { minimalScene } from '../fixtures/minimal';
import { marbleRun } from '../../src/scenes/marble-run';

beforeAll(initPhysics);

function harness() {
  const responses: WorkerResponse[] = [];
  const runtime = new PhysicsRuntime((response) => responses.push(response));
  let sequence = 0;
  const send = (payload: CommandPayload, sessionId = 'session-a') =>
    runtime.handle({ ...payload, protocolVersion: 1, sessionId, sequence: ++sequence });
  return { runtime, responses, send };
}

describe('worker runtime with real Rapier', () => {
  it('applies play/pause/step with bounded wall scheduling and clears resume debt', () => {
    const { runtime, send, responses } = harness();
    runtime.advance(0);
    runtime.handle(null);
    send({ type: 'loadScene', scene: minimalScene });
    send({ type: 'step' });
    expect(responses.filter((r) => r.type === 'transforms').at(-1)?.tick).toBe(1);
    send({ type: 'play' });
    runtime.advance(0);
    runtime.advance(1000);
    expect(runtime.clock.droppedTimeSeconds).toBeCloseTo(115 / 120);
    send({ type: 'pause' });
    runtime.advance(8000);
    expect(runtime.playing).toBe(false);
    send({ type: 'play' });
    runtime.advance(10000);
    runtime.advance(10001);
    send({ type: 'pause' });
    expect(responses.filter((r) => r.type === 'transforms').at(-1)?.tick).toBe(6);
    expect(responses.some((r) => r.type === 'metrics' && r.stepDurationMs >= 0)).toBe(true);
    runtime.dispose();
    runtime.dispose();
  });
  it('reconstructs on reset and rejects an old command against the new world', () => {
    const { runtime, send, responses } = harness();
    send({ type: 'loadScene', scene: minimalScene });
    send({ type: 'applyImpulse', bodyId: 'ball', impulse: { x: 1, y: 2, z: 0 } });
    send({ type: 'step' });
    send({ type: 'reset', scene: minimalScene }, 'session-b');
    const initial = responses.filter((r) => r.type === 'transforms').at(-1)!;
    expect(initial.tick).toBe(0);
    expect(initial.bodies[0]!.position).toEqual(minimalScene.bodies[0]!.position);
    const length = responses.length;
    send({ type: 'step' });
    expect(responses).toHaveLength(length);
    expect(responses.filter((r) => r.sessionId === 'session-b').map((r) => r.sequence)).toEqual([
      1, 2, 3, 4,
    ]);
    runtime.dispose();
  });
  it('applies gravity and constraint commands, reports invalid targets without crashing', () => {
    const { runtime, send, responses } = harness();
    send({ type: 'loadScene', scene: minimalScene });
    send({ type: 'setGravity', gravity: { x: 0, y: 0, z: 0 } });
    send({ type: 'beginGrab', bodyId: 'ball', target: { x: 0, y: 4, z: 0 } });
    send({ type: 'moveGrab', target: { x: 1, y: 5, z: 0 } });
    send({ type: 'step' });
    send({ type: 'endGrab' });
    send({ type: 'cancelGrab' });
    send({ type: 'beginGrab', bodyId: 'missing', target: { x: 0, y: 4, z: 0 } });
    expect(responses.at(-1)?.type).toBe('error');
    send({ type: 'applyImpulse', bodyId: 'missing', impulse: { x: 0, y: 0, z: 0 } });
    expect(responses.at(-1)?.type).toBe('error');
    send({ type: 'play' });
    send({ type: 'step' });
    expect(responses.at(-1)?.type).toBe('error');
    expect(runtime.playing).toBe(false);
    runtime.dispose();
  });
  it('publishes collision and goal events once in a sequenced session', () => {
    const { runtime, send, responses } = harness();
    send({ type: 'loadScene', scene: marbleRun });
    send({ type: 'play' });
    for (let frame = 0; frame < 400; frame++) runtime.advance((frame * 1000) / 60);
    expect(responses.some((r) => r.type === 'collisionEvent')).toBe(true);
    expect(responses.filter((r) => r.type === 'goalEvent')).toHaveLength(1);
    expect(responses.map((r) => r.sequence)).toEqual(responses.map((_, index) => index + 1));
    runtime.dispose();
  });
  it('preserves response order even for a same-session reconstruction', () => {
    const { runtime, send, responses } = harness();
    send({ type: 'loadScene', scene: minimalScene });
    send({ type: 'reset', scene: minimalScene });
    expect(responses.map((r) => r.sequence)).toEqual(responses.map((_, index) => index + 1));
    runtime.dispose();
  });
  it('pauses and reports scheduler failures instead of repeatedly throwing', () => {
    const { runtime, send, responses } = harness();
    send({ type: 'loadScene', scene: minimalScene });
    send({ type: 'play' });
    vi.spyOn(runtime.clock, 'advance').mockImplementationOnce(() => {
      throw new Error('Integration failure');
    });
    runtime.advance(1);
    expect(runtime.playing).toBe(false);
    expect(responses.at(-1)).toMatchObject({ type: 'error', message: 'Integration failure' });
    send({ type: 'play' });
    vi.spyOn(runtime.clock, 'advance').mockImplementationOnce(() => {
      throw 'unknown';
    });
    runtime.advance(2);
    expect(responses.at(-1)).toMatchObject({ type: 'error', message: 'Physics command failed.' });
    runtime.dispose();
  });
});
