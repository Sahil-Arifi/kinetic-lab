import { describe, expect, it } from 'vitest';
import { parseScene, parseSceneJson } from '../../src/engine/scene-schema';
import { config, configurationSchema, FIXED_DT } from '../../src/engine/configuration';
import {
  CommandGate,
  ResponseGate,
  commandSchema,
  responseSchema,
} from '../../src/engine/protocol';
import { minimalScene } from '../fixtures/minimal';

describe('scene and configuration contracts', () => {
  it('validates and clones a document through the common JSON path', () => {
    expect(parseSceneJson(JSON.stringify(minimalScene))).toEqual(minimalScene);
    expect(parseScene(minimalScene)).not.toBe(minimalScene);
    expect(FIXED_DT).toBe(1 / 120);
    expect(configurationSchema.parse(config)).toEqual(config);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, 1001])('rejects invalid dynamic mass %s', (mass) => {
    const scene = structuredClone(minimalScene);
    scene.bodies[0]!.mass = mass;
    expect(() => parseScene(scene)).toThrow();
  });
  it.each([0, -1, 41, Infinity, NaN])('rejects unsafe dimensions %s', (value) => {
    const scene = structuredClone(minimalScene);
    scene.bodies[0]!.dimensions.x = value;
    expect(() => parseScene(scene)).toThrow();
  });
  it('rejects duplicate IDs, unsupported types, invalid versions and executable properties', () => {
    expect(() =>
      parseScene({ ...minimalScene, bodies: [...minimalScene.bodies, ...minimalScene.bodies] }),
    ).toThrow();
    expect(() =>
      parseScene({ ...minimalScene, bodies: [{ ...minimalScene.bodies[0], type: 'script' }] }),
    ).toThrow();
    for (const property of [
      { schemaVersion: 2 },
      { name: '<b>hello</b>' },
      { name: 'https://evil.example' },
      { callback: 'alert(1)' },
      { script: () => 1 },
    ])
      expect(() => parseScene({ ...minimalScene, ...property })).toThrow();
    expect(() => parseSceneJson('{bad json')).toThrow();
    expect(() => parseSceneJson(' '.repeat(1_000_001))).toThrow('1 MB');
  });
  it('requires valid fixed cups and barriers, equal sphere dimensions, and goal references', () => {
    const body = minimalScene.bodies[0]!;
    expect(() =>
      parseScene({ ...minimalScene, bodies: [{ ...body, type: 'fixedBarrier' }] }),
    ).toThrow();
    expect(() =>
      parseScene({
        ...minimalScene,
        bodies: [
          { ...body, type: 'targetCup', bodyMode: 'fixed', dimensions: { x: 0.2, y: 0.2, z: 0.2 } },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseScene({ ...minimalScene, bodies: [{ ...body, dimensions: { x: 1, y: 0.5, z: 0.5 } }] }),
    ).toThrow();
    expect(() =>
      parseScene({
        ...minimalScene,
        goals: [{ id: 'goal', bodyId: 'absent', sensorBodyId: 'ball', dwellTicks: 1 }],
      }),
    ).toThrow();
    const goal = { id: 'goal', bodyId: 'ball', sensorBodyId: 'cup', dwellTicks: 24 };
    const valid = {
      ...minimalScene,
      bodies: [body, { ...body, id: 'cup', type: 'targetCup', bodyMode: 'fixed' }],
      goals: [goal],
    };
    expect(parseScene(valid).goals).toHaveLength(1);
    expect(() => parseScene({ ...valid, goals: [goal, goal] })).toThrow();
    expect(() => configurationSchema.parse({ ...config, physicsHz: 60 })).toThrow();
    expect(() => configurationSchema.parse({ ...config, maxCatchUpSteps: 100 })).toThrow();
    expect(() => configurationSchema.parse({ ...config, maxGrabSpeed: Infinity })).toThrow();
  });
});

describe('protocol isolation', () => {
  const envelope = { protocolVersion: 1, sessionId: 'session-a', sequence: 1 };
  it('validates each command and rejects malformed payloads', () => {
    const target = { x: 1, y: 2, z: 3 };
    const payloads = [
      { type: 'loadScene', scene: minimalScene },
      { type: 'reset', scene: minimalScene },
      ...['play', 'pause', 'step', 'endGrab', 'cancelGrab'].map((type) => ({ type })),
      { type: 'setGravity', gravity: target },
      { type: 'beginGrab', bodyId: 'ball', target },
      { type: 'moveGrab', target },
      { type: 'applyImpulse', bodyId: 'ball', impulse: target },
    ];
    for (const payload of payloads)
      expect(commandSchema.parse({ ...envelope, ...payload })).toEqual({ ...envelope, ...payload });
    for (const value of [
      null,
      4,
      {},
      { ...envelope, type: 'play', script: 'run' },
      { ...envelope, type: 'unknown' },
      { ...envelope, type: 'moveGrab', target: { ...target, x: NaN } },
      { ...envelope, type: 'play', protocolVersion: 2 },
    ])
      expect(commandSchema.safeParse(value).success).toBe(false);
  });
  it('ignores old, duplicate, out-of-order, malformed and previous-session responses', () => {
    const gate = new ResponseGate('session-a');
    const ready = { ...envelope, type: 'ready' };
    expect(gate.accept(ready)?.type).toBe('ready');
    expect(gate.accept(ready)).toBeUndefined();
    expect(gate.accept({ ...ready, sequence: 3 })).toBeDefined();
    expect(gate.accept({ ...ready, sequence: 2 })).toBeUndefined();
    expect(gate.accept({ ...ready, sequence: 4, protocolVersion: 2 })).toBeUndefined();
    gate.replace('session-b');
    const stalePayloads = [
      { type: 'ready' },
      {
        type: 'transforms',
        tick: 999,
        bodies: [
          {
            id: 'ball',
            position: { x: 99, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            sleeping: false,
          },
        ],
      },
      { type: 'goalEvent', goalId: 'goal', bodyId: 'ball', tick: 999 },
      {
        type: 'metrics',
        tick: 999,
        stepDurationMs: 1,
        activeBodies: 5,
        sleepingBodies: 0,
        droppedTimeSeconds: 99,
      },
      { type: 'commandApplied', command: 'play', tick: 999, playing: true },
      { type: 'error', message: 'Error from previous world' },
      { type: 'collisionEvent', bodyA: 'ball', bodyB: 'floor', started: true },
    ];
    for (const payload of stalePayloads) {
      const stale = { ...envelope, sequence: 999, ...payload };
      expect(responseSchema.safeParse(stale).success).toBe(true);
      expect(gate.accept(stale)).toBeUndefined();
    }
    expect(gate.accept({ ...ready, sessionId: 'session-b' })).toBeDefined();
  });
  it('only changes command sessions through load/reset and never revives retired worlds', () => {
    const gate = new CommandGate();
    expect(gate.accept(null)).toBeUndefined();
    expect(gate.accept({ ...envelope, type: 'play' })).toBeUndefined();
    const load = { ...envelope, type: 'loadScene', scene: minimalScene };
    expect(gate.accept(load)).toBeDefined();
    expect(gate.accept(load)).toBeUndefined();
    expect(gate.accept({ ...envelope, sequence: 2, type: 'play' })).toBeDefined();
    expect(gate.accept({ ...load, sessionId: 'session-b', type: 'reset' })).toBeDefined();
    expect(gate.accept({ ...load, sequence: 999 })).toBeUndefined();
    expect(
      gate.accept({ ...envelope, sessionId: 'session-c', sequence: 1, type: 'play' }),
    ).toBeUndefined();
  });
  it('validates every response variant', () => {
    const responses = [
      { type: 'ready' },
      { type: 'commandApplied', command: 'play', tick: 1, playing: true },
      {
        type: 'transforms',
        tick: 1,
        bodies: [
          {
            id: 'ball',
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            sleeping: false,
          },
        ],
      },
      { type: 'collisionEvent', bodyA: 'ball', bodyB: 'floor', started: true },
      { type: 'goalEvent', goalId: 'goal', bodyId: 'ball', tick: 4 },
      {
        type: 'metrics',
        tick: 1,
        stepDurationMs: 1,
        activeBodies: 1,
        sleepingBodies: 0,
        droppedTimeSeconds: 0,
      },
      { type: 'error', message: 'No body' },
    ];
    for (const response of responses)
      expect(responseSchema.safeParse({ ...envelope, ...response }).success).toBe(true);
  });
});
