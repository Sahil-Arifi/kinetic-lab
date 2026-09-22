import { FixedClock } from './clock';
import { config } from './configuration';
import {
  CommandGate,
  PROTOCOL_VERSION,
  type ResponsePayload,
  type WorkerResponse,
} from './protocol';
import { PhysicsWorld } from './world';

/** Worker runtime: the only production owner of PhysicsWorld. No rendering dependency. */
export class PhysicsRuntime {
  readonly clock = new FixedClock();
  private readonly gate = new CommandGate();
  private world: PhysicsWorld | undefined;
  private sessionId = '';
  private sequence = 0;
  private lastSnapshotMs = -Infinity;
  private lastMetricsMs = -Infinity;
  private stepDurationMs = 0;
  playing = false;

  constructor(
    private readonly output: (response: WorkerResponse) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  private emit(payload: ResponsePayload): void {
    this.output({
      ...payload,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
    });
  }

  handle(input: unknown): void {
    const message = this.gate.accept(input);
    if (!message) return;
    try {
      if (message.type === 'loadScene' || message.type === 'reset') {
        if (this.sessionId !== message.sessionId) this.sequence = 0;
        this.sessionId = message.sessionId;
        this.playing = false;
        this.clock.reset();
        this.stepDurationMs = 0;
        this.lastSnapshotMs = -Infinity;
        this.lastMetricsMs = -Infinity;
        if (this.world) this.world.reset(message.scene);
        else this.world = new PhysicsWorld(message.scene);
        this.emit({ type: 'ready' });
      } else {
        // Gate accepts ordinary commands only after a valid world-creation command.
        const world = this.world;
        if (!world) throw new Error('Load a scene before sending commands.');
        switch (message.type) {
          case 'play':
            this.clock.clearWallTime();
            this.playing = true;
            break;
          case 'pause':
            this.playing = false;
            this.clock.clearWallTime();
            world.endGrab();
            break;
          case 'step':
            if (this.playing) throw new Error('Pause before single stepping.');
            this.step();
            break;
          case 'setGravity':
            world.setGravity(message.gravity);
            break;
          case 'beginGrab':
            if (!world.beginGrab(message.bodyId, message.target))
              throw new Error('Only dynamic objects can be grabbed.');
            break;
          case 'moveGrab':
            world.moveGrab(message.target);
            break;
          case 'endGrab':
          case 'cancelGrab':
            world.endGrab();
            break;
          case 'applyImpulse':
            if (!world.applyImpulse(message.bodyId, message.impulse))
              throw new Error('Impulse target must be dynamic.');
            break;
        }
      }
      this.emit({
        type: 'commandApplied',
        command: message.type,
        tick: this.world?.tick ?? 0,
        playing: this.playing,
      });
      if (message.type !== 'moveGrab') this.publish(true);
    } catch (failure) {
      this.fail(failure);
    }
  }

  private step(): void {
    if (!this.world) return;
    const start = this.now();
    const events = this.world.step();
    this.stepDurationMs = Math.max(0, this.now() - start);
    for (const collision of events.collisions) this.emit({ type: 'collisionEvent', ...collision });
    for (const goal of events.goals) this.emit({ type: 'goalEvent', ...goal });
  }

  advance(nowMs: number): void {
    if (!this.playing) return;
    try {
      this.clock.advance(nowMs, () => this.step());
      this.publish(false, nowMs);
    } catch (failure) {
      this.fail(failure);
    }
  }

  private fail(failure: unknown): void {
    this.playing = false;
    this.world?.endGrab();
    this.clock.clearWallTime();
    this.emit({
      type: 'error',
      message: failure instanceof Error ? failure.message.slice(0, 500) : 'Physics command failed.',
    });
  }

  private publish(force: boolean, nowMs = this.now()): void {
    if (!this.world) return;
    if (force || nowMs - this.lastSnapshotMs >= 1000 / config.snapshotHz) {
      this.emit({ type: 'transforms', tick: this.world.tick, bodies: this.world.snapshot() });
      this.lastSnapshotMs = nowMs;
    }
    if (force || nowMs - this.lastMetricsMs >= 250) {
      this.emit({
        type: 'metrics',
        tick: this.world.tick,
        stepDurationMs: this.stepDurationMs,
        ...this.world.metrics(),
        droppedTimeSeconds: this.clock.droppedTimeSeconds,
      });
      this.lastMetricsMs = nowMs;
    }
  }

  dispose(): void {
    this.playing = false;
    this.world?.dispose();
    this.world = undefined;
    this.clock.reset();
  }
}
