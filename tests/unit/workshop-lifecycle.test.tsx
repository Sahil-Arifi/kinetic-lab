// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../../src/engine/protocol';
import { useWorkshop } from '../../src/hooks/useWorkshop';

// Only the worker transport is replaced. These are simulated DOM lifecycle checks;
// numerical physics and real client session filtering have independent tests.
const transport = vi.hoisted(() => ({
  send: vi.fn(),
  load: vi.fn(),
  reset: vi.fn(),
  restart: vi.fn(),
  dispose: vi.fn(),
  receive: undefined as ((response: WorkerResponse) => void) | undefined,
}));

vi.mock('../../src/engine/client', () => ({
  PhysicsClient: class {
    constructor(receive: (response: WorkerResponse) => void) {
      transport.receive = receive;
    }
    send = transport.send;
    load = transport.load;
    reset = transport.reset;
    restart = transport.restart;
    dispose = transport.dispose;
  },
}));

const envelope = { protocolVersion: 1 as const, sessionId: 'lifecycle-test', sequence: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  transport.receive = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('workshop lifecycle with a simulated visibility state', () => {
  it('cancels the grab before pausing when hidden and does not resume when visible', () => {
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useWorkshop());
    act(() => transport.receive!({ ...envelope, type: 'ready' }));
    act(() => result.current.togglePlayback());
    act(() => result.current.beginGrab('marble', { x: -6, y: 3, z: 0 }));
    expect(result.current.playing).toBe(true);
    expect(result.current.grabbing).toBe(true);
    const epoch = result.current.interactionEpoch;
    transport.send.mockClear();

    visibility.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(transport.send.mock.calls).toEqual([[{ type: 'cancelGrab' }], [{ type: 'pause' }]]);
    expect(result.current.playing).toBe(false);
    expect(result.current.grabbing).toBe(false);
    expect(result.current.interactionEpoch).toBe(epoch + 1);
    expect(result.current.announcement).toBe('Simulation paused while the page is hidden.');

    transport.send.mockClear();
    visibility.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(transport.send).not.toHaveBeenCalled();
    expect(result.current.playing).toBe(false);
  });

  it('resets from the latest authored scene after cancelling the current grab', () => {
    const { result } = renderHook(() => useWorkshop());
    act(() => result.current.updateBody('marble', { mass: 4 }));
    act(() => result.current.beginGrab('marble', { x: -6, y: 3, z: 0 }));
    act(() => {
      transport.receive!({
        ...envelope,
        type: 'goalEvent',
        goalId: 'marble-home',
        bodyId: 'marble',
        tick: 593,
      });
      transport.receive!({
        ...envelope,
        type: 'transforms',
        tick: 593,
        bodies: [
          {
            id: 'marble',
            position: { x: 7, y: 0.3, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            sleeping: false,
          },
        ],
      });
      transport.receive!({
        ...envelope,
        type: 'commandApplied',
        command: 'play',
        tick: 593,
        playing: true,
      });
    });
    expect(result.current.goal).toBe(true);
    expect(result.current.transforms.current.size).toBe(1);
    const epoch = result.current.interactionEpoch;
    transport.send.mockClear();

    act(() => result.current.reset());

    expect(transport.send).toHaveBeenCalledExactlyOnceWith({ type: 'cancelGrab' });
    expect(transport.reset).toHaveBeenCalledExactlyOnceWith(result.current.scene);
    expect(transport.send.mock.invocationCallOrder[0]!).toBeLessThan(
      transport.reset.mock.invocationCallOrder[0]!,
    );
    expect(result.current.scene.bodies.find((body) => body.id === 'marble')!.mass).toBe(4);
    expect(result.current.interactionEpoch).toBe(epoch + 1);
    expect(result.current.grabbing).toBe(false);
    expect(result.current.playing).toBe(false);
    expect(result.current.goal).toBe(false);
    expect(result.current.metrics.tick).toBe(0);
    expect(result.current.transforms.current.size).toBe(0);
  });

  it('disposes the worker and removes lifecycle listeners on unmount', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { unmount } = renderHook(() => useWorkshop());
    const deliverLateResponse = transport.receive!;
    unmount();
    expect(transport.dispose).toHaveBeenCalledOnce();
    transport.send.mockClear();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      deliverLateResponse({ ...envelope, type: 'error', message: 'Late worker event' });
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('invalidates a live canvas drag on worker failure so release cannot author its stale target', () => {
    const { result } = renderHook(() => useWorkshop());
    act(() => result.current.togglePlayback());
    act(() => result.current.beginGrab('marble', { x: -6, y: 3, z: 0 }));
    const authored = result.current.scene;
    const epoch = result.current.interactionEpoch;
    transport.load.mockClear();
    transport.reset.mockClear();

    act(() => transport.receive!({ ...envelope, type: 'error', message: 'Physics step failed' }));

    // The canvas observes this epoch and clears its pending drag target.
    expect(result.current.interactionEpoch).toBe(epoch + 1);
    expect(result.current.grabbing).toBe(false);
    expect(result.current.playing).toBe(false);
    expect(result.current.error).toBe('Physics step failed');
    expect(result.current.scene).toBe(authored);
    expect(transport.load).not.toHaveBeenCalled();
    expect(transport.reset).not.toHaveBeenCalled();
  });
});
