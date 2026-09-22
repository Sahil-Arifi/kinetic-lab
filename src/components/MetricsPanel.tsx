export interface PerformanceMetrics {
  frameIntervalMs: number;
  stepDurationMs: number;
  activeBodies: number;
  sleepingBodies: number;
  drawCalls: number;
  droppedTimeSeconds: number;
  tick: number;
}
export const initialMetrics: PerformanceMetrics = {
  frameIntervalMs: 0,
  stepDurationMs: 0,
  activeBodies: 0,
  sleepingBodies: 0,
  drawCalls: 0,
  droppedTimeSeconds: 0,
  tick: 0,
};
export function MetricsPanel({ metrics }: { metrics: PerformanceMetrics }) {
  const entries = [
    ['Render interval', `${metrics.frameIntervalMs.toFixed(1)} ms`],
    ['Physics step', `${metrics.stepDurationMs.toFixed(3)} ms`],
    ['Active bodies', metrics.activeBodies],
    ['Sleeping bodies', metrics.sleepingBodies],
    ['Draw calls', metrics.drawCalls],
    ['Dropped time', `${metrics.droppedTimeSeconds.toFixed(3)} s`],
  ];
  return (
    <section className="metrics-panel" aria-labelledby="metrics-heading">
      <div className="section-label">
        <h2 id="metrics-heading">Inspect performance</h2>
        <span className="live-dot" />
      </div>
      <dl>
        {entries.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>Live instrumentation on this device. Not a benchmark.</p>
    </section>
  );
}
