export interface MetricBuffer {
  readonly capacity: number;
  readonly values: readonly number[];
}
export interface MetricSummary {
  latest: number;
  average: number;
  min: number;
  max: number;
  samples: number;
}

export function createMetricBuffer(capacity = 120): MetricBuffer {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) {
    throw new RangeError('Metric buffer capacity must be an integer from 1 through 10000.');
  }
  return { capacity, values: [] };
}

export function recordMetric(buffer: MetricBuffer, value: number): MetricBuffer {
  // A dropped renderer/worker observation must never poison every later average.
  if (!Number.isFinite(value) || value < 0) return buffer;
  return { capacity: buffer.capacity, values: [...buffer.values, value].slice(-buffer.capacity) };
}

export function summarizeMetric(buffer: MetricBuffer): MetricSummary {
  if (buffer.values.length === 0) return { latest: 0, average: 0, min: 0, max: 0, samples: 0 };
  let average = 0;
  // Incremental mean avoids overflowing a sum of otherwise finite measurements.
  buffer.values.forEach((value, index) => {
    average += (value - average) / (index + 1);
  });
  return {
    latest: buffer.values[buffer.values.length - 1]!,
    average,
    min: Math.min(...buffer.values),
    max: Math.max(...buffer.values),
    samples: buffer.values.length,
  };
}

export function frameInterval(
  previousTimestamp: number | null,
  currentTimestamp: number,
): number | null {
  if (
    previousTimestamp === null ||
    !Number.isFinite(previousTimestamp) ||
    !Number.isFinite(currentTimestamp)
  )
    return null;
  const interval = currentTimestamp - previousTimestamp;
  return Number.isFinite(interval) && interval >= 0 ? interval : null;
}
