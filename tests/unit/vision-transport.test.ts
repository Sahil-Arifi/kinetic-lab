import { describe, expect, it, vi } from 'vitest';
import { VISION_PROTOCOL_VERSION, VisionFrameTransport } from '../../src/input/vision-transport';
import type { VisionFrame } from '../../src/input/vision-transport';

const frame = () => ({ close: vi.fn() });
type Frame = ReturnType<typeof frame>;
const reply = (sequence: number, overrides: Record<string, unknown> = {}) => ({
  type: 'landmarks',
  protocolVersion: VISION_PROTOCOL_VERSION,
  sessionId: 'session-a',
  sequence,
  ...overrides,
});
function deferred() {
  let resolve!: (value: Frame) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Frame>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const post = vi.fn<(request: VisionFrame<Frame>) => void>();
  return { post, transport: new VisionFrameTransport('session-a', post, 100) };
}

describe('bounded vision frame transport', () => {
  it('reserves the slot during capture and until a matching response', async () => {
    const { transport, post } = setup();
    const d = deferred();
    const bitmap = frame();
    const capture = vi.fn(() => d.promise);
    expect(transport.state).toBe('idle');
    const first = transport.submit(0, capture);
    expect(transport.state).toBe('capturing');
    expect(transport.accept(reply(1))).toBeNull();
    expect(await transport.submit(10, capture)).toBe(false);
    d.resolve(bitmap);
    expect(await first).toBe(true);
    expect(transport.state).toBe('awaiting');
    expect(post).toHaveBeenCalledWith({ type: 'frame', protocolVersion: 1, sessionId: 'session-a', sequence: 1, timestampMs: 0, frame: bitmap });
    expect(await transport.submit(20, capture)).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(transport.accept(reply(1))).toBe('landmarks');
    expect(transport.state).toBe('idle');
    expect(await transport.submit(30, async () => frame())).toBe(true);
    expect(post.mock.calls[1]?.[0].sequence).toBe(2);
    expect(transport.accept(reply(1))).toBeNull();
    expect(transport.accept(reply(2))).toBe('landmarks');
  });

  it('rejects malformed, stale and foreign responses without releasing the slot', async () => {
    const { transport } = setup();
    await transport.submit(0, async () => frame());
    for (const message of [null, 1, {}, reply(1, { protocolVersion: 2 }), reply(1, { sessionId: 'old' }), reply(2), reply(1, { type: 'ready' })]) {
      expect(transport.accept(message)).toBeNull();
      expect(transport.state).toBe('awaiting');
    }
    expect(transport.accept(reply(1))).toBe('landmarks');
    expect(transport.accept(reply(1))).toBeNull();
  });

  it('drops a late captured frame after disposal and never posts it', async () => {
    const { transport, post } = setup();
    const d = deferred();
    const bitmap = frame();
    const pending = transport.submit(0, () => d.promise);
    transport.dispose();
    transport.dispose();
    d.resolve(bitmap);
    expect(await pending).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect(transport.state).toBe('closed');
    expect(await transport.submit(1, async () => frame())).toBe(false);
  });

  it('does not close a frame already transferred before disposal', async () => {
    const { transport } = setup();
    const bitmap = frame();
    await transport.submit(0, async () => bitmap);
    transport.dispose();
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(transport.accept(reply(1))).toBeNull();
  });

  it('closes a session on capture failure, including a late rejection', async () => {
    const a = setup();
    expect(await a.transport.submit(0, async () => { throw new Error('capture failed'); })).toBe(false);
    expect(a.transport.state).toBe('closed');
    const b = setup();
    const d = deferred();
    const pending = b.transport.submit(0, () => d.promise);
    b.transport.dispose();
    d.reject(new Error('late'));
    expect(await pending).toBe(false);
    expect(b.transport.state).toBe('closed');
  });

  it('closes producer-owned frame if posting fails', async () => {
    const { transport, post } = setup();
    post.mockImplementation(() => { throw new Error('worker failed'); });
    const bitmap = frame();
    expect(await transport.submit(0, async () => bitmap)).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(transport.state).toBe('closed');
  });

  it('does not reuse a session after worker failure', async () => {
    const { transport } = setup();
    await transport.submit(0, async () => frame());
    expect(transport.accept(reply(1, { type: 'failed' }))).toBe('failed');
    expect(transport.state).toBe('closed');
    expect(await transport.submit(1, async () => frame())).toBe(false);
  });

  it('expires a stuck capture or worker and refuses late replies', async () => {
    const a = setup();
    expect(a.transport.expire(100)).toBe(false);
    const d = deferred();
    const pending = a.transport.submit(10, () => d.promise);
    expect(a.transport.expire(NaN)).toBe(false);
    expect(a.transport.expire(109)).toBe(false);
    expect(a.transport.expire(110)).toBe(true);
    const bitmap = frame();
    d.resolve(bitmap);
    expect(await pending).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    const b = setup();
    await b.transport.submit(0, async () => frame());
    expect(b.transport.expire(100)).toBe(true);
    expect(b.transport.accept(reply(1))).toBeNull();
    expect(b.transport.state).toBe('closed');
  });

  it('validates session, timeout and monotonically increasing timestamps', async () => {
    const { post, transport } = setup();
    expect(() => new VisionFrameTransport(' ', post)).toThrow(RangeError);
    expect(() => new VisionFrameTransport('ok', post, Infinity)).toThrow(RangeError);
    expect(() => new VisionFrameTransport('ok', post, 0)).toThrow(RangeError);
    const capture = vi.fn(async () => frame());
    expect(await transport.submit(NaN, capture)).toBe(false);
    expect(await transport.submit(-1, capture)).toBe(false);
    expect(await transport.submit(10, capture)).toBe(true);
    transport.accept(reply(1));
    expect(await transport.submit(10, capture)).toBe(false);
    expect(await transport.submit(9, capture)).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
