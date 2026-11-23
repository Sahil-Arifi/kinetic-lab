import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_CONSTRAINTS,
  CameraController,
  type CameraStatus,
} from '../../src/input/camera';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  private listeners = new Set<() => void>();
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });

  constructor(readonly kind: 'video' | 'audio' = 'video') {}

  addEventListener(event: string, listener: () => void): void {
    if (event === 'ended') this.listeners.add(listener);
  }
  removeEventListener(event: string, listener: () => void): void {
    if (event === 'ended') this.listeners.delete(listener);
  }
  end(): void {
    this.readyState = 'ended';
    for (const listener of this.listeners) listener();
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

function stream(...tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.unstubAllGlobals());

describe('opt-in camera lifecycle', () => {
  it('requests video only after explicit enable and releases every track', async () => {
    const video = new FakeTrack();
    const unexpectedAudio = new FakeTrack('audio');
    const source = stream(video, unexpectedAudio);
    const changes = vi.fn<(status: CameraStatus) => void>();
    const open = vi.fn(async () => source);
    const controller = new CameraController(changes, open);

    expect(open).not.toHaveBeenCalled();
    expect(controller.status.phase).toBe('disabled');
    expect(await controller.enable()).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(CAMERA_CONSTRAINTS);
    expect(CAMERA_CONSTRAINTS.audio).toBe(false);
    expect(controller.status).toEqual({ phase: 'active', stream: source, message: null });
    expect(changes.mock.calls.map(([s]) => s.phase)).toEqual(['requesting', 'active']);
    expect(video.listenerCount).toBe(1);
    controller.disable();
    expect(video.stop).toHaveBeenCalledOnce();
    expect(unexpectedAudio.stop).toHaveBeenCalledOnce();
    expect(video.listenerCount).toBe(0);
    expect(controller.status).toEqual({ phase: 'disabled', stream: null, message: null });
  });

  it('does not create duplicate requests while active or awaiting permission', async () => {
    const pending = deferred<MediaStream>();
    const open = vi.fn(() => pending.promise);
    const controller = new CameraController(vi.fn(), open);
    const first = controller.enable();
    expect(await controller.enable()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    pending.resolve(stream(new FakeTrack()));
    expect(await first).toBe(true);
    expect(await controller.enable()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('stops a late granted stream after disable without activating it', async () => {
    const pending = deferred<MediaStream>();
    const video = new FakeTrack();
    const changes = vi.fn();
    const controller = new CameraController(changes, () => pending.promise);
    const request = controller.enable();
    controller.disable();
    const before = changes.mock.calls.length;
    pending.resolve(stream(video));
    expect(await request).toBe(false);
    expect(video.stop).toHaveBeenCalledOnce();
    expect(controller.status.phase).toBe('disabled');
    expect(changes).toHaveBeenCalledTimes(before);
    controller.disable();
    expect(changes).toHaveBeenCalledTimes(before);
  });

  it('ignores old permission errors after a newer request succeeds', async () => {
    const old = deferred<MediaStream>();
    const current = deferred<MediaStream>();
    const open = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
    const controller = new CameraController(vi.fn(), open);
    const obsoleteRequest = controller.enable();
    controller.disable();
    const freshRequest = controller.enable();
    current.resolve(stream(new FakeTrack()));
    expect(await freshRequest).toBe(true);
    old.reject(new DOMException('blocked', 'NotAllowedError'));
    expect(await obsoleteRequest).toBe(false);
    expect(controller.status.phase).toBe('active');
    controller.dispose();
  });

  it('fails closed on empty or ended video tracks', async () => {
    const audio = new FakeTrack('audio');
    const empty = new CameraController(vi.fn(), async () => stream(audio));
    expect(await empty.enable()).toBe(false);
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(empty.status.message).toContain('no active video');

    const ended = new FakeTrack();
    ended.end();
    const inactive = new CameraController(vi.fn(), async () => stream(ended));
    expect(await inactive.enable()).toBe(false);
    expect(ended.stop).toHaveBeenCalledOnce();
    expect(inactive.status.phase).toBe('error');
  });

  it('shuts down automatically when the track ends and never restarts capture', async () => {
    const video = new FakeTrack();
    const source = stream(video);
    const open = vi.fn(async () => source);
    const controller = new CameraController(vi.fn(), open);
    await controller.enable();
    video.end();
    expect(controller.status.phase).toBe('error');
    expect(controller.status.message).toContain('disconnected');
    expect(controller.status.stream).toBeNull();
    expect(video.stop).toHaveBeenCalledOnce();
    expect(video.listenerCount).toBe(0);
    video.end();
    expect(open).toHaveBeenCalledTimes(1);
    controller.disable();
    expect(controller.status.message).toBeNull();
  });

  it.each([
    ['NotAllowedError', 'permission was denied'],
    ['PermissionDeniedError', 'permission was denied'],
    ['SecurityError', 'permission was denied'],
    ['NotFoundError', 'No camera was found'],
    ['DevicesNotFoundError', 'No camera was found'],
    ['NotReadableError', 'unavailable or in use'],
    ['TrackStartError', 'unavailable or in use'],
    ['AbortError', 'Could not start'],
  ])('explains %s without activating a stream', async (name, expected) => {
    const controller = new CameraController(vi.fn(), async () => {
      throw new DOMException('internal browser detail', name);
    });
    expect(await controller.enable()).toBe(false);
    expect(controller.status.phase).toBe('error');
    expect(controller.status.message).toContain(expected);
    expect(controller.status.stream).toBeNull();
  });

  it('handles unsupported browsers using the default opener', async () => {
    vi.stubGlobal('navigator', {});
    const controller = new CameraController(vi.fn());
    expect(await controller.enable()).toBe(false);
    expect(controller.status.message).toContain('Could not start');
    controller.disable();
  });

  it('uses the default browser opener when mediaDevices exists', async () => {
    const getUserMedia = vi.fn(async () => stream(new FakeTrack()));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const controller = new CameraController(vi.fn());
    expect(await controller.enable()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith(CAMERA_CONSTRAINTS);
    controller.dispose();
  });
});
