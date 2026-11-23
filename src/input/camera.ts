/**
 * Explicit, opt-in camera acquisition. This module does not start capture on
 * import, retain frames, record audio, or initialize a vision model.
 *
 * Permission requests cannot reliably be cancelled by browsers. A generation
 * token makes a late permission grant harmless: its tracks are stopped before
 * the stream can become active or reach consumers.
 */
export type CameraPhase = 'disabled' | 'requesting' | 'active' | 'error';

export interface CameraStatus {
  phase: CameraPhase;
  stream: MediaStream | null;
  message: string | null;
}

export type CameraOpener = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
    facingMode: 'user',
  },
};

const defaultOpener: CameraOpener = (constraints) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('Camera capture is not supported in this browser.'));
  }
  return navigator.mediaDevices.getUserMedia(constraints);
};

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera permission was denied. You can continue using pointer and keyboard controls.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a camera to try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is unavailable or in use by another application.';
    default:
      return 'Could not start the camera. Pointer and keyboard controls remain available.';
  }
}

/** Owns exactly one camera stream and invalidates pending permission requests. */
export class CameraController {
  private generation = 0;
  private stream: MediaStream | null = null;
  private current: CameraStatus = { phase: 'disabled', stream: null, message: null };

  constructor(
    private readonly onChange: (status: CameraStatus) => void,
    private readonly open: CameraOpener = defaultOpener,
  ) {}

  get status(): CameraStatus {
    return this.current;
  }

  private update(phase: CameraPhase, stream: MediaStream | null, message: string | null): void {
    this.current = { phase, stream, message };
    this.onChange(this.current);
  }

  private stopStream(stream: MediaStream): void {
    for (const track of stream.getVideoTracks()) track.removeEventListener('ended', this.onTrackEnded);
    for (const track of stream.getTracks()) track.stop();
  }

  private release(): void {
    const stream = this.stream;
    this.stream = null;
    if (stream) this.stopStream(stream);
  }

  private readonly onTrackEnded = (): void => {
    if (this.current.phase !== 'active') return;
    ++this.generation;
    this.release();
    this.update('error', null, 'The camera disconnected. Hand controls must be enabled again.');
  };

  async enable(): Promise<boolean> {
    if (this.current.phase === 'active' || this.current.phase === 'requesting') return false;
    const generation = ++this.generation;
    this.update('requesting', null, null);
    try {
      const stream = await this.open(CAMERA_CONSTRAINTS);
      if (generation !== this.generation) {
        this.stopStream(stream);
        return false;
      }
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0 || !videoTracks.some((track) => track.readyState === 'live')) {
        this.stopStream(stream);
        this.update('error', null, 'The camera returned no active video track.');
        return false;
      }
      this.stream = stream;
      for (const track of videoTracks) track.addEventListener('ended', this.onTrackEnded);
      this.update('active', stream, null);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.update('error', null, cameraError(error));
      return false;
    }
  }

  /** Safe during an outstanding permission prompt, active capture, or after failure. */
  disable(): void {
    ++this.generation;
    this.release();
    if (this.current.phase !== 'disabled') this.update('disabled', null, null);
  }

  dispose(): void {
    this.disable();
  }
}
