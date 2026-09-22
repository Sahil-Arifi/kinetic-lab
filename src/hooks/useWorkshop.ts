import { useCallback, useEffect, useRef, useState } from 'react';
import { PhysicsClient } from '../engine/client';
import type { Transform, WorkerResponse } from '../engine/protocol';
import {
  sceneSchema,
  type BodyDocument,
  type SceneDocument,
  type Vec3,
} from '../engine/scene-schema';
import { createHistory, commitScene, undo, redo } from '../editor/history';
import {
  addBody,
  deleteBody,
  duplicateBody,
  editBody,
  setSceneGravity,
} from '../editor/operations';
import { resolveKeyboardAction } from '../input/keyboard';
import { marbleRun } from '../scenes/marble-run';
import { initialMetrics } from '../components/MetricsPanel';

export function useWorkshop() {
  const [history, setHistory] = useState(() => createHistory(marbleRun));
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>('marble');
  const [announcement, setAnnouncement] = useState('Marble Run ready. Press Play to begin.');
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState(false);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [interactionEpoch, setInteractionEpoch] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  const transforms = useRef(new Map<string, Transform>());
  const client = useRef<PhysicsClient | null>(null);
  const authored = useRef(history.present);
  authored.current = history.present;

  useEffect(() => {
    let active = true;
    const instance = new PhysicsClient((response: WorkerResponse) => {
      if (!active) return;
      switch (response.type) {
        case 'ready':
          setReady(true);
          break;
        case 'transforms':
          transforms.current = new Map(response.bodies.map((body) => [body.id, body]));
          break;
        case 'commandApplied':
          setPlaying(response.playing);
          setMetrics((m) => ({ ...m, tick: response.tick }));
          break;
        case 'metrics':
          setMetrics((m) => ({
            ...m,
            tick: response.tick,
            stepDurationMs: response.stepDurationMs,
            activeBodies: response.activeBodies,
            sleepingBodies: response.sleepingBodies,
            droppedTimeSeconds: response.droppedTimeSeconds,
          }));
          break;
        case 'goalEvent':
          setGoal(true);
          setAnnouncement('Goal reached. The marble stayed in the finish cup.');
          break;
        case 'error':
          setError(response.message);
          setPlaying(false);
          setGrabbing(false);
          // Clear the renderer's drag before a later pointer-up can become a paused edit.
          setInteractionEpoch((value) => value + 1);
          break;
      }
    });
    client.current = instance;
    instance.load(authored.current);
    return () => {
      active = false;
      instance.dispose();
      client.current = null;
    };
  }, []);

  const cancelGrab = useCallback(() => {
    client.current?.send({ type: 'cancelGrab' });
    setGrabbing(false);
    setInteractionEpoch((value) => value + 1);
  }, []);
  const togglePlayback = useCallback(() => {
    cancelGrab();
    client.current?.send({ type: playing ? 'pause' : 'play' });
    setPlaying(!playing);
    setAnnouncement(playing ? 'Simulation paused.' : 'Simulation started.');
  }, [cancelGrab, playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveKeyboardAction(event);
      if (action === 'cancelGrab') {
        event.preventDefault();
        cancelGrab();
      }
      if (action === 'togglePlayback' && ready && !error) {
        event.preventDefault();
        togglePlayback();
      }
    };
    const onVisibility = () => {
      if (!document.hidden) return;
      cancelGrab();
      client.current?.send({ type: 'pause' });
      setPlaying(false);
      setAnnouncement('Simulation paused while the page is hidden.');
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cancelGrab, error, ready, togglePlayback]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setAnnouncement(
      `${authored.current.bodies.find((body) => body.id === id)?.name ?? 'Object'} selected.`,
    );
  }, []);
  const replaceWorld = useCallback(
    (scene: SceneDocument) => {
      cancelGrab();
      transforms.current.clear();
      setGoal(false);
      setPlaying(false);
      setError(null);
      setMetrics((m) => ({ ...m, tick: 0, droppedTimeSeconds: 0 }));
      client.current?.load(scene);
    },
    [cancelGrab],
  );
  const commit = useCallback(
    (scene: SceneDocument) => {
      setHistory((previous) => commitScene(previous, scene));
      replaceWorld(scene);
    },
    [replaceWorld],
  );
  const safeEdit = useCallback(
    (operation: () => SceneDocument) => {
      if (playing) return;
      try {
        commit(operation());
        setError(null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Invalid scene change.');
      }
    },
    [commit, playing],
  );
  const updateBody = useCallback(
    (id: string, patch: Partial<BodyDocument>) =>
      safeEdit(() => editBody(authored.current, id, patch)),
    [safeEdit],
  );
  const add = useCallback(
    (type: BodyDocument['type']) =>
      safeEdit(() => {
        const scene = addBody(authored.current, type);
        const added = scene.bodies.at(-1);
        if (added) select(added.id);
        return scene;
      }),
    [safeEdit, select],
  );
  const duplicate = useCallback(() => {
    if (selectedId)
      safeEdit(() => {
        const scene = duplicateBody(authored.current, selectedId);
        const added = scene.bodies.at(-1);
        if (added) setSelectedId(added.id);
        return scene;
      });
  }, [safeEdit, selectedId]);
  const remove = useCallback(() => {
    if (selectedId)
      safeEdit(() => {
        const scene = deleteBody(authored.current, selectedId);
        setSelectedId(scene.bodies[0]?.id ?? null);
        return scene;
      });
  }, [safeEdit, selectedId]);
  const travelHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      if (playing) return;
      const next = direction === 'undo' ? undo(history) : redo(history);
      setHistory(next);
      replaceWorld(next.present);
      if (!next.present.bodies.some((body) => body.id === selectedId))
        setSelectedId(next.present.bodies[0]?.id ?? null);
    },
    [history, playing, replaceWorld, selectedId],
  );
  const reset = useCallback(() => {
    cancelGrab();
    transforms.current.clear();
    setGoal(false);
    setPlaying(false);
    setError(null);
    setMetrics((m) => ({ ...m, tick: 0, droppedTimeSeconds: 0 }));
    client.current?.reset(authored.current);
    setAnnouncement('Scene reset to its authored state.');
  }, [cancelGrab]);
  const changeGravity = useCallback((y: number) => {
    try {
      const next = setSceneGravity(authored.current, {
        ...authored.current.gravity,
        y,
      });
      setHistory((previous) => commitScene(previous, next));
      client.current?.send({ type: 'setGravity', gravity: next.gravity });
    } catch {
      setError('Gravity must be a finite value within the scene limits.');
    }
  }, []);
  const restart = useCallback(() => {
    cancelGrab();
    transforms.current.clear();
    setError(null);
    setGoal(false);
    setReady(false);
    setPlaying(false);
    client.current?.restart(authored.current);
    setAnnouncement('Physics worker restarted.');
  }, [cancelGrab]);
  const importScene = useCallback(
    (value: unknown) => {
      if (playing) return;
      try {
        const scene = sceneSchema.parse(value);
        commit(scene);
        setSelectedId(scene.bodies[0]?.id ?? null);
        setAnnouncement('Scene imported.');
      } catch {
        setError(
          'Scene import rejected. Use a valid Kinetic Lab scene document with supported objects and finite values.',
        );
      }
    },
    [commit, playing],
  );
  const beginGrab = useCallback((bodyId: string, target: Vec3) => {
    setGrabbing(true);
    client.current?.send({ type: 'beginGrab', bodyId, target });
  }, []);
  const moveGrab = useCallback(
    (target: Vec3) => client.current?.send({ type: 'moveGrab', target }),
    [],
  );
  const endGrab = useCallback((cancelled = false) => {
    setGrabbing(false);
    client.current?.send({ type: cancelled ? 'cancelGrab' : 'endGrab' });
  }, []);
  const sampleRender = useCallback(
    (frameIntervalMs: number, drawCalls: number) =>
      setMetrics((m) => ({ ...m, frameIntervalMs, drawCalls })),
    [],
  );
  return {
    scene: history.present,
    playing,
    ready,
    selectedId,
    selected: history.present.bodies.find((body) => body.id === selectedId),
    announcement,
    error,
    goal,
    metrics,
    interactionEpoch,
    grabbing,
    transforms,
    select,
    togglePlayback,
    reset,
    changeGravity,
    updateBody,
    add,
    duplicate,
    remove,
    undo: () => travelHistory('undo'),
    redo: () => travelHistory('redo'),
    canUndo: history.past.length > 0 && !playing,
    canRedo: history.future.length > 0 && !playing,
    step: () => client.current?.send({ type: 'step' }),
    beginGrab,
    moveGrab,
    endGrab,
    cancelGrab,
    restart,
    importScene,
    reportError: setError,
    sampleRender,
  };
}
