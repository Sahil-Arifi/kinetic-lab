import { describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../src/engine/clock';

describe('120 Hz accumulator', () => {
  it('accumulates fractions without changing dt', () => {
    const clock = new FixedClock();
    const step = vi.fn();
    expect(clock.advance(0, step)).toBe(0);
    expect(clock.advance(4, step)).toBe(0);
    expect(clock.advance(10, step)).toBe(1);
    expect(clock.advance(25, step)).toBe(2);
    expect(step).toHaveBeenCalledTimes(3);
  });
  it('bounds catch-up to five and records discarded whole ticks', () => {
    const clock = new FixedClock();
    const step = vi.fn();
    clock.advance(0, step);
    expect(clock.advance(1000, step)).toBe(5);
    expect(clock.droppedTimeSeconds).toBeCloseTo(115 / 120, 12);
    expect(clock.advance(1000, step)).toBe(0);
    clock.reset();
    expect(clock.droppedTimeSeconds).toBe(0);
    expect(clock.advance(5000, step)).toBe(0);
  });
  it('clears wall time before resume and ignores invalid/backward deltas', () => {
    const clock = new FixedClock();
    const step = vi.fn();
    clock.advance(0, step);
    clock.advance(5, step);
    clock.clearWallTime();
    expect(clock.advance(90000, step)).toBe(0);
    expect(clock.advance(NaN, step)).toBe(0);
    expect(clock.advance(89999, step)).toBe(0);
    expect(step).not.toHaveBeenCalled();
  });
  it('produces the same ticks for 30, 60, 144 Hz render scheduling', () => {
    for (const hz of [30, 60, 144]) {
      const clock = new FixedClock();
      const step = vi.fn();
      for (let frame = 0; frame <= hz; frame++) clock.advance((frame * 1000) / hz, step);
      expect(step).toHaveBeenCalledTimes(120);
      expect(clock.droppedTimeSeconds).toBe(0);
    }
  });
});
