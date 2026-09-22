import { describe, expect, it, vi } from 'vitest';
import { PhysicsClient, type WorkerPort } from '../../src/engine/client';
import type { WorkerCommand } from '../../src/engine/protocol';
import { minimalScene } from '../fixtures/minimal';

class Port implements WorkerPort {
  messages: WorkerCommand[] = [];
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  terminate = vi.fn();
  postMessage(message: WorkerCommand): void { this.messages.push(message); }
  respond(data: unknown): void { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

describe('main-thread client world isolation', () => {
  it('rejects old responses after reset, replacement and worker restart', () => {
    const ports: Port[] = []; const receive = vi.fn();
    const client = new PhysicsClient(receive, () => { const port = new Port(); ports.push(port); return port; });
    client.load(minimalScene);
    const first = ports[0]!; const firstSession = first.messages[0]!.sessionId;
    const response = { type: 'ready', protocolVersion: 1, sessionId: firstSession, sequence: 1 };
    first.respond(response); expect(receive).toHaveBeenCalledTimes(1);
    client.reset(minimalScene);
    first.respond({ ...response, sequence: 500 }); expect(receive).toHaveBeenCalledTimes(1);
    const resetSession = first.messages.at(-1)!.sessionId;
    expect(resetSession).not.toBe(firstSession);
    first.respond({ ...response, sessionId: resetSession }); expect(receive).toHaveBeenCalledTimes(2);
    client.load(minimalScene);
    first.respond({ ...response, sessionId: resetSession, sequence: 501 }); expect(receive).toHaveBeenCalledTimes(2);
    const oldMessage = first.onmessage!; const oldError = first.onerror!;
    client.restart(minimalScene);
    expect(first.terminate).toHaveBeenCalledOnce();
    oldMessage({ data: { ...response, sequence: 900 } } as MessageEvent<unknown>);
    oldError({ message: 'stale failure' } as ErrorEvent);
    expect(receive).toHaveBeenCalledTimes(2);
    const fresh = ports[1]!;
    fresh.respond({ ...response, sessionId: fresh.messages[0]!.sessionId }); expect(receive).toHaveBeenCalledTimes(3);
    fresh.respond({ ...response, sessionId: fresh.messages[0]!.sessionId }); expect(receive).toHaveBeenCalledTimes(3);
    client.dispose();
  });
  it('delivers every discrete command in sequence, validates before sending, and disposes once', () => {
    const port = new Port(); const receive = vi.fn();
    const client = new PhysicsClient(receive, () => port);
    client.load(minimalScene);
    client.send({ type: 'beginGrab', bodyId: 'ball', target: { x: 0, y: 4, z: 0 } });
    client.send({ type: 'moveGrab', target: { x: 1, y: 4, z: 0 } });
    client.send({ type: 'endGrab' }); client.send({ type: 'cancelGrab' });
    expect(port.messages.map(m => m.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(port.messages.map(m => m.type)).toEqual(['loadScene', 'beginGrab', 'moveGrab', 'endGrab', 'cancelGrab']);
    expect(() => client.send({ type: 'moveGrab', target: { x: Infinity, y: 0, z: 0 } })).toThrow();
    expect(() => client.load({ ...minimalScene, schemaVersion: 2 } as unknown as typeof minimalScene)).toThrow();
    expect(port.messages).toHaveLength(5);
    port.onerror?.({ message: 'load failed' } as ErrorEvent);
    expect(receive.mock.lastCall?.[0].message).toBe('load failed');
    port.onerror?.({ message: '' } as ErrorEvent);
    expect(receive.mock.lastCall?.[0].message).toContain('Restart');
    const onmessage = port.onmessage!; const onerror = port.onerror!;
    client.dispose(); client.dispose(); client.send({ type: 'play' });
    onmessage({ data: {} } as MessageEvent<unknown>); onerror({ message: 'late' } as ErrorEvent);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(port.messages).toHaveLength(5); expect(port.terminate).toHaveBeenCalledOnce();
  });
  it('constructs a module worker by default', () => {
    const port = new Port();
    const WorkerConstructor = vi.fn(function () { return port; });
    vi.stubGlobal('Worker', WorkerConstructor);
    const client = new PhysicsClient(vi.fn());
    expect(WorkerConstructor).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ type: 'module' }));
    client.dispose(); vi.unstubAllGlobals();
  });
});
