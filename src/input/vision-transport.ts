/**
 * Bounded transport for a future dedicated vision worker. The producer owns
 * frames until successful transfer; the worker must close transferred frames.
 * Each instance is single-use and belongs to one unique vision session.
 */
export const VISION_PROTOCOL_VERSION = 1;

export interface FrameResource {
  close(): void;
}

export interface VisionFrame<T extends FrameResource> {
  type: 'frame';
  protocolVersion: typeof VISION_PROTOCOL_VERSION;
  sessionId: string;
  sequence: number;
  timestampMs: number;
  frame: T;
}

export type FrameReply = 'landmarks' | 'failed';

interface PendingFrame {
  sequence: number;
  timestampMs: number;
  sent: boolean;
}

export class VisionFrameTransport<T extends FrameResource> {
  private pending: PendingFrame | null = null;
  private sequence = 0;
  private lastTimestamp = -1;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly post: (request: VisionFrame<T>) => void,
    private readonly timeoutMs = 1000,
  ) {
    if (!sessionId.trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('A nonempty vision session and positive timeout are required.');
  }

  get state(): 'idle' | 'capturing' | 'awaiting' | 'closed' {
    if (this.closed) return 'closed';
    if (!this.pending) return 'idle';
    return this.pending.sent ? 'awaiting' : 'capturing';
  }

  /**
   * The slot is reserved BEFORE asynchronous frame creation. Busy capture
   * opportunities are skipped rather than queued. A successful post transfers
   * ownership of the frame to the worker; a throwing post does not.
   */
  async submit(timestampMs: number, capture: () => Promise<T>): Promise<boolean> {
    if (this.closed || this.pending) return false;
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.lastTimestamp)
      return false;
    this.lastTimestamp = timestampMs;
    const pending: PendingFrame = { sequence: ++this.sequence, timestampMs, sent: false };
    this.pending = pending;
    let frame: T;
    try {
      frame = await capture();
    } catch {
      if (this.pending === pending) this.dispose();
      return false;
    }
    if (this.pending !== pending) {
      frame.close();
      return false;
    }
    pending.sent = true;
    try {
      this.post({
        type: 'frame',
        protocolVersion: VISION_PROTOCOL_VERSION,
        sessionId: this.sessionId,
        sequence: pending.sequence,
        timestampMs,
        frame,
      });
    } catch {
      this.dispose();
      frame.close();
      return false;
    }
    return true;
  }

  /**
   * Acknowledge only the currently posted frame. The caller must separately
   * validate landmark payloads before using them. Failure closes the session.
   */
  accept(message: unknown): FrameReply | null {
    const pending = this.pending;
    if (!pending?.sent || typeof message !== 'object' || message === null) return null;
    const reply = message as Record<string, unknown>;
    if (
      reply.protocolVersion !== VISION_PROTOCOL_VERSION ||
      reply.sessionId !== this.sessionId ||
      reply.sequence !== pending.sequence ||
      (reply.type !== 'landmarks' && reply.type !== 'failed')
    ) return null;
    this.pending = null;
    if (reply.type === 'failed') this.dispose();
    return reply.type;
  }

  /**
   * Call from the capture scheduler/watchdog with the same monotonic clock as
   * submit. A timed-out session must be replaced, not reused: the old worker may
   * still be processing its transferred frame. Caller must terminate the worker.
   */
  expire(nowMs: number): boolean {
    if (!this.pending || !Number.isFinite(nowMs) ||
        nowMs - this.pending.timestampMs < this.timeoutMs) return false;
    this.dispose();
    return true;
  }

  /** Invalidate pending capture and replies; caller owns worker termination. */
  dispose(): void {
    this.closed = true;
    this.pending = null;
  }
}
