import { config, FIXED_DT } from './configuration';

/** Wall-clock scheduling never changes the integrator's numerical timestep. */
export class FixedClock {
  private previousMs: number | undefined;
  private accumulator = 0;
  droppedTimeSeconds = 0;
  reset(): void {
    this.previousMs = undefined;
    this.accumulator = 0;
    this.droppedTimeSeconds = 0;
  }
  clearWallTime(): void {
    this.previousMs = undefined;
    this.accumulator = 0;
  }
  advance(nowMs: number, step: () => void): number {
    if (!Number.isFinite(nowMs)) return 0;
    if (this.previousMs === undefined) {
      this.previousMs = nowMs;
      return 0;
    }
    const elapsed = Math.max(0, (nowMs - this.previousMs) / 1000);
    this.previousMs = nowMs;
    this.accumulator += elapsed;
    let count = 0;
    while (this.accumulator + 1e-12 >= FIXED_DT && count < config.maxCatchUpSteps) {
      step();
      this.accumulator -= FIXED_DT;
      count++;
    }
    if (this.accumulator + 1e-12 >= FIXED_DT) {
      const droppedSteps = Math.floor((this.accumulator + 1e-12) / FIXED_DT);
      const dropped = droppedSteps * FIXED_DT;
      this.droppedTimeSeconds += dropped;
      this.accumulator -= dropped;
    }
    this.accumulator = Math.max(0, this.accumulator);
    return count;
  }
}
