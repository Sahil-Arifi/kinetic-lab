import { parseScene, type SceneDocument } from '../engine/scene-schema';

/** Authored documents only: these snapshots never contain runtime transforms. */
export interface History {
  readonly past: readonly SceneDocument[];
  readonly present: SceneDocument;
  readonly future: readonly SceneDocument[];
  readonly limit: number;
}

export function createHistory(scene: SceneDocument, limit = 50): History {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('History limit must be an integer between 1 and 500.');
  }
  return { past: [], present: parseScene(scene), future: [], limit };
}

export function commitScene(history: History, scene: SceneDocument): History {
  const present = parseScene(scene);
  if (JSON.stringify(present) === JSON.stringify(history.present)) return history;
  return {
    past: [...history.past, parseScene(history.present)].slice(-history.limit),
    present,
    future: [],
    limit: history.limit,
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: parseScene(previous),
    future: [parseScene(history.present), ...history.future].slice(0, history.limit),
    limit: history.limit,
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, parseScene(history.present)].slice(-history.limit),
    present: parseScene(next),
    future: history.future.slice(1),
    limit: history.limit,
  };
}
