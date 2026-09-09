import { describe, expect, it } from 'vitest';
import { createMetricBuffer, frameInterval, recordMetric, summarizeMetric } from '../../src/metrics/runtime';

describe('bounded runtime metrics', () => {
  it('reports actual measurements and caps retained samples', () => {
    const initial = createMetricBuffer(3);
    const buffer = [10, 20, 30, 40].reduce(recordMetric, initial);
    expect(buffer.values).toEqual([20, 30, 40]);
    expect(summarizeMetric(buffer)).toEqual({ latest: 40, average: 30, min: 20, max: 40, samples: 3 });
    expect(initial.values).toEqual([]);
    expect(createMetricBuffer().capacity).toBe(120);
  });

  it('uses empty results and ignores corrupt or negative observations', () => {
    const initial = createMetricBuffer();
    expect(summarizeMetric(initial)).toEqual({ latest: 0, average: 0, min: 0, max: 0, samples: 0 });
    for (const invalid of [NaN, Infinity, -Infinity, -1]) expect(recordMetric(initial, invalid)).toBe(initial);
    expect(summarizeMetric(recordMetric(initial, 0))).toEqual({ latest: 0, average: 0, min: 0, max: 0, samples: 1 });
  });

  it('avoids overflow from summing large but finite measurements', () => {
    const buffer = [Number.MAX_VALUE, Number.MAX_VALUE].reduce(recordMetric, createMetricBuffer());
    expect(summarizeMetric(buffer).average).toBe(Number.MAX_VALUE);
  });

  it.each([0, -1, 1.5, 10_001, Infinity, NaN])('rejects invalid buffer capacity %s', (capacity) => {
    expect(() => createMetricBuffer(capacity)).toThrow(RangeError);
  });

  it('calculates elapsed render intervals without manufacturing an initial frame', () => {
    expect(frameInterval(null, 100)).toBeNull();
    expect(frameInterval(100, 116.5)).toBe(16.5);
    expect(frameInterval(100, 100)).toBe(0);
    expect(frameInterval(100, 99)).toBeNull();
    expect(frameInterval(NaN, 100)).toBeNull();
    expect(frameInterval(100, Infinity)).toBeNull();
    expect(frameInterval(-Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
  });
});
