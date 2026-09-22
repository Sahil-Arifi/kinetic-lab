import { describe, expect, it } from 'vitest';
import { parseScene, type SceneDocument } from '../../src/engine/scene-schema';
import { commitScene, createHistory, redo, undo } from '../../src/editor/history';
import { addBody, deleteBody, duplicateBody, editBody, setSceneGravity } from '../../src/editor/operations';

function scene(): SceneDocument {
  return parseScene({
    schemaVersion: 1, id: 'editor-test', name: 'Editor test', seed: 1,
    gravity: { x: 0, y: -9.81, z: 0 },
    bodies: [{
      id: 'marble', name: 'Marble', type: 'sphere', position: { x: 0, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, dimensions: { x: 0.5, y: 0.5, z: 0.5 },
      mass: 1, friction: 0.3, restitution: 0.1, bodyMode: 'dynamic',
    }, {
      id: 'cup', name: 'Target cup', type: 'targetCup', position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, dimensions: { x: 1.2, y: 0.5, z: 1.2 },
      mass: 1, friction: 0.5, restitution: 0.1, bodyMode: 'fixed',
    }],
    goals: [{ id: 'goal', bodyId: 'marble', sensorBodyId: 'cup', dwellTicks: 60 }],
  });
}

describe('authored scene operations', () => {
  it('edits every supported numeric field immutably and validates the result', () => {
    const initial = scene();
    const edited = editBody(initial, 'marble', {
      position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.1, y: 0.2, z: 0.3 },
      mass: 2, friction: 0.6, restitution: 0.2,
    });
    expect(edited.bodies[0]).toMatchObject({ position: { x: 1, y: 2, z: 3 }, mass: 2, friction: 0.6 });
    expect(initial.bodies[0]!.position).toEqual({ x: 0, y: 3, z: 0 });
    expect(edited.bodies[1]).toEqual(initial.bodies[1]);
    expect(() => editBody(initial, 'marble', { mass: -1 })).toThrow();
    expect(() => editBody(initial, 'marble', { position: { x: NaN, y: 0, z: 0 } })).toThrow();
    expect(() => editBody(initial, 'missing', { mass: 1 })).toThrow('does not exist');
  });

  it.each(['sphere', 'block', 'domino', 'ramp', 'fixedBarrier', 'targetCup'] as const)(
    'adds a valid %s with deterministic collision-free IDs', (type) => {
      const first = addBody(scene(), type);
      const second = addBody(first, type);
      expect(first.bodies.at(-1)!.id).toBe(`${type}-1`);
      expect(second.bodies.at(-1)!.id).toBe(`${type}-2`);
      expect(addBody(scene(), type)).toEqual(first);
      expect(new Set(second.bodies.map((body) => body.id)).size).toBe(second.bodies.length);
      expect(second.bodies.at(-1)!.bodyMode).toBe(['sphere', 'block', 'domino'].includes(type) ? 'dynamic' : 'fixed');
    },
  );

  it('duplicates appearance and material without duplicating goal definitions', () => {
    const initial = scene();
    const once = duplicateBody(initial, 'marble');
    const twice = duplicateBody(once, 'marble');
    expect(once.bodies.at(-1)).toMatchObject({ id: 'marble-copy-1', name: 'Marble copy', mass: 1 });
    expect(once.bodies.at(-1)!.position.x).toBeCloseTo(0.7);
    expect(twice.bodies.at(-1)!.id).toBe('marble-copy-2');
    expect(twice.goals).toEqual(initial.goals);
    expect(initial.bodies).toHaveLength(2);
    expect(() => duplicateBody(initial, 'missing')).toThrow('does not exist');
  });

  it('deletes a goal participant or sensor together with dangling goal references', () => {
    expect(deleteBody(scene(), 'marble').goals).toEqual([]);
    expect(deleteBody(scene(), 'cup').goals).toEqual([]);
    const withBlock = addBody(scene(), 'block');
    expect(deleteBody(withBlock, 'block-1').goals).toHaveLength(1);
    expect(deleteBody(withBlock, 'block-1').bodies).toHaveLength(2);
    expect(() => deleteBody(scene(), 'missing')).toThrow('does not exist');
  });

  it('duplicates valid maximum-length identifiers and names within scene bounds', () => {
    const initial = scene();
    initial.bodies[0]!.id = 'm'.repeat(64);
    initial.bodies[0]!.name = 'M'.repeat(80);
    initial.bodies[0]!.position.x = 100;
    initial.goals[0]!.bodyId = initial.bodies[0]!.id;
    const result = duplicateBody(initial, initial.bodies[0]!.id);
    expect(result.bodies.at(-1)!.id).toHaveLength(64);
    expect(result.bodies.at(-1)!.name).toHaveLength(80);
    expect(result.bodies.at(-1)!.position.x).toBe(100);
    expect(result.bodies.at(-1)!.id).not.toBe(initial.bodies[0]!.id);
  });

  it('validates gravity changes and rejects malformed documents before editing', () => {
    expect(setSceneGravity(scene(), { x: 1, y: 0, z: 2 }).gravity).toEqual({ x: 1, y: 0, z: 2 });
    expect(() => setSceneGravity(scene(), { x: 0, y: Infinity, z: 0 })).toThrow();
    const invalid = { ...scene(), schemaVersion: 99 } as unknown as SceneDocument;
    expect(() => addBody(invalid, 'block')).toThrow();
  });
});

describe('bounded authored history', () => {
  it('undoes and redoes document changes without mutating old history', () => {
    const original = createHistory(scene());
    const edited = editBody(original.present, 'marble', { mass: 2 });
    const committed = commitScene(original, edited);
    const undone = undo(committed);
    expect(undone.present).toEqual(original.present);
    expect(redo(undone).present).toEqual(edited);
    expect(committed.past).toHaveLength(1);
    expect(original.past).toEqual([]);
    expect(undo(original)).toBe(original);
    expect(redo(original)).toBe(original);
  });

  it('bounds past history and discards the abandoned redo branch after an edit', () => {
    let history = createHistory(scene(), 2);
    for (const mass of [2, 3, 4]) history = commitScene(history, editBody(history.present, 'marble', { mass }));
    expect(history.past).toHaveLength(2);
    const oldest = undo(undo(history));
    expect(oldest.present.bodies[0]!.mass).toBe(2);
    expect(undo(oldest)).toBe(oldest);
    const branched = commitScene(oldest, editBody(oldest.present, 'marble', { mass: 7 }));
    expect(branched.future).toEqual([]);
    expect(redo(branched)).toBe(branched);
    expect(redo(redo(oldest)).present.bodies[0]!.mass).toBe(4);
  });

  it('does not add no-op snapshots or retain caller-owned objects', () => {
    const initial = scene();
    const history = createHistory(initial);
    expect(commitScene(history, scene())).toBe(history);
    initial.bodies[0]!.mass = 9;
    expect(history.present.bodies[0]!.mass).toBe(1);
    const edited = editBody(history.present, 'marble', { mass: 2 });
    const next = commitScene(history, edited);
    edited.bodies[0]!.mass = 10;
    expect(next.present.bodies[0]!.mass).toBe(2);
    expect(() => commitScene(history, { ...history.present, seed: NaN })).toThrow();
  });

  it.each([0, -1, 1.5, 501, Infinity, NaN])('rejects invalid history capacity %s', (capacity) => {
    expect(() => createHistory(scene(), capacity)).toThrow(RangeError);
  });
});
