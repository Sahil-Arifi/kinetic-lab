import { useRef, useState } from 'react';
import { AccessibleObjectList } from './components/AccessibleObjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { ObjectInspector } from './components/ObjectInspector';
import { ObjectTray } from './components/ObjectTray';
import { WorkshopCanvas } from './components/WorkshopCanvas';
import { WorkshopToolbar } from './components/WorkshopToolbar';
import { useWorkshop } from './hooks/useWorkshop';

export default function App() {
  const workshop = useWorkshop();
  const [mode, setMode] = useState<'object' | 'orbit'>('object');
  const [depth, setDepth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [cameraFocus, setCameraFocus] = useState({ x: 0.4, y: 1, z: 0 });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const changeZoom = (delta: number) => {
    const next = Math.max(0.75, Math.min(3, zoom + delta));
    setZoom(next);
    if (next <= 1) setCameraFocus({ x: 0.4, y: 1, z: 0 });
    else if (workshop.selected) {
      setCameraFocus(
        workshop.transforms.current.get(workshop.selected.id)?.position ??
          workshop.selected.position,
      );
    }
  };
  const exportScene = () => {
    const blob = new Blob([JSON.stringify(workshop.scene, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workshop.scene.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      workshop.reportError('This scene is too large. Use a JSON file smaller than 1 MB.');
      return;
    }
    try {
      workshop.importScene(JSON.parse(await file.text()) as unknown);
    } catch {
      workshop.reportError('Could not read this scene. Choose a valid JSON scene document.');
    }
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#object-controls"
        onClick={() => {
          setInspectorOpen(true);
          requestAnimationFrame(() => document.getElementById('object-controls')?.focus());
        }}
      >
        Skip to object controls
      </a>
      <WorkshopToolbar
        playing={workshop.playing}
        ready={workshop.ready && !workshop.error}
        gravity={workshop.scene.gravity.y}
        canUndo={workshop.canUndo}
        canRedo={workshop.canRedo}
        onToggle={workshop.togglePlayback}
        onStep={workshop.step}
        onReset={workshop.reset}
        onGravity={workshop.changeGravity}
        onUndo={workshop.undo}
        onRedo={workshop.redo}
      />
      <main className="workshop-layout">
        <section id="workbench" className="workbench" aria-labelledby="experiment-title">
          <ErrorBoundary onRetry={workshop.restart}>
            <WorkshopCanvas
              scene={workshop.scene}
              selectedId={workshop.selectedId}
              transforms={workshop.transforms}
              playing={workshop.playing}
              mode={mode}
              goal={workshop.goal}
              depth={depth}
              interactionEpoch={workshop.interactionEpoch}
              zoom={zoom}
              focus={cameraFocus}
              onSelect={workshop.select}
              onBeginGrab={workshop.beginGrab}
              onMoveGrab={workshop.moveGrab}
              onEndGrab={workshop.endGrab}
              onEditPosition={(id, position) => workshop.updateBody(id, { position })}
              onDepth={setDepth}
              onSample={workshop.sampleRender}
            />
          </ErrorBoundary>
          <div className="experiment-heading">
            <div className="experiment-index">
              <span>EXPERIMENT 001</span>
              <span className="experiment-line" /> MARBLE RUN
            </div>
            <h1 id="experiment-title">
              {workshop.scene.name === 'The cascade' ? (
                <>
                  A little push.
                  <br />
                  <span>A chain reaction.</span>
                </>
              ) : (
                workshop.scene.name
              )}
            </h1>
            <p>
              Gravity, momentum, and a satisfying finish.
              <br />
              Set it in motion. Then make it your own.
            </p>
          </div>
          <div className="scene-top-actions">
            <button
              className="inspector-toggle"
              aria-label="Inspector"
              aria-expanded={inspectorOpen}
              aria-controls="object-controls"
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              Inspector <span>{inspectorOpen ? '−' : '+'}</span>
            </button>
            <button
              className={`inspect-toggle ${showMetrics ? 'is-active' : ''}`}
              aria-label="Inspect performance"
              aria-expanded={showMetrics}
              onClick={() => setShowMetrics(!showMetrics)}
            >
              <Icon name="inspect" />
              <span>Inspect</span>
            </button>
            <div className="zoom-controls" role="group" aria-label="Camera zoom">
              <button
                aria-label="Zoom out"
                title="Zoom out"
                disabled={zoom <= 0.75}
                onClick={() => changeZoom(-0.25)}
              >
                −
              </button>
              <button
                aria-label="Zoom in"
                title="Zoom toward selected object"
                disabled={zoom >= 3}
                onClick={() => changeZoom(0.25)}
              >
                +
              </button>
            </div>
          </div>
          <div className="scene-axis" aria-hidden="true">
            <span className="axis-y">Y</span>
            <span className="axis-z">Z</span>
            <span className="axis-x">X</span>
            <i />
          </div>
          {workshop.goal && (
            <div className="goal-banner">
              <span className="goal-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Experiment complete</strong>
                <span>Marble settled. Chain reaction delivered.</span>
              </div>
              <button onClick={workshop.reset} aria-label="Run experiment again">
                <Icon name="reset" />
              </button>
            </div>
          )}
          {!workshop.ready && !workshop.error && (
            <div className="loading-status" role="status">
              Preparing the physics workbench…
            </div>
          )}
          {workshop.error && (
            <div className="error-banner" role="alert">
              <strong>The experiment needs attention</strong>
              <p>{workshop.error}</p>
              <button onClick={workshop.restart}>Restart physics</button>
              <button onClick={() => workshop.reportError(null)}>Dismiss</button>
            </div>
          )}
          <div className="interaction-dock">
            <div className="interaction-modes" role="group" aria-label="Pointer interaction mode">
              <button
                aria-pressed={mode === 'object'}
                onClick={() => {
                  workshop.cancelGrab();
                  setMode('object');
                }}
              >
                <Icon name="move" />
                <span>Move objects</span>
              </button>
              <button
                aria-pressed={mode === 'orbit'}
                onClick={() => {
                  workshop.cancelGrab();
                  setMode('orbit');
                }}
              >
                <Icon name="orbit" />
                <span>Orbit view</span>
              </button>
            </div>
            <label className="depth-control">
              <span>DEPTH</span>
              <input
                type="range"
                aria-label="Grab depth"
                min="-5"
                max="5"
                step="0.1"
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
              />
              <output>{depth.toFixed(1)}</output>
            </label>
          </div>
          {showMetrics && (
            <div className="metrics-overlay">
              <MetricsPanel metrics={workshop.metrics} />
            </div>
          )}
          <div className="scene-bottom-line">
            <span>
              <i className={workshop.playing ? 'running-dot' : ''} />{' '}
              {workshop.playing ? 'SIMULATION RUNNING' : 'PAUSED · READY TO EXPLORE'}
            </span>
            <span data-testid="simulation-tick">
              TICK {workshop.metrics.tick.toString().padStart(5, '0')}
            </span>
            <span>
              120 Hz <span className="muted">/ FIXED STEP</span>
            </span>
          </div>
        </section>
        <aside
          id="object-controls"
          tabIndex={-1}
          className={`inspector ${inspectorOpen ? 'inspector--open' : ''}`}
          aria-label="Object controls"
        >
          <div className="inspector-title">
            <span>THE WORKBENCH</span>
            <button
              className="inspector-close icon-button"
              aria-label="Close inspector"
              onClick={() => setInspectorOpen(false)}
            >
              <Icon name="close" />
            </button>
            <span className="inspector-number">01 / LAB</span>
          </div>
          <ObjectInspector
            body={workshop.selected}
            playing={workshop.playing}
            onUpdate={workshop.updateBody}
            onDuplicate={workshop.duplicate}
            onDelete={workshop.remove}
          />
          <AccessibleObjectList
            bodies={workshop.scene.bodies}
            selectedId={workshop.selectedId}
            onSelect={workshop.select}
          />
          <div className="scene-file-actions">
            <button onClick={exportScene}>
              <Icon name="download" /> Export scene
            </button>
            <button disabled={workshop.playing} onClick={() => upload.current?.click()}>
              <Icon name="upload" /> Import JSON
            </button>
            <input
              className="sr-only"
              ref={upload}
              type="file"
              accept=".json,application/json"
              aria-label="Import scene JSON file"
              tabIndex={-1}
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </aside>
      </main>
      <ObjectTray playing={workshop.playing} onAdd={workshop.add} />
      <footer className="app-footer">
        <span>A PLAYGROUND FOR PHYSICAL CURIOSITY.</span>
        <span>
          <kbd>SPACE</kbd> play / pause <span className="footer-separator">·</span> <kbd>ESC</kbd>{' '}
          release <span className="footer-separator">·</span> <kbd>↑ ↓</kbd> or scroll to change
          drag depth
        </span>
        <span>
          BUILT BY SAHIL ARIFI <span className="accent-dot">↗</span>
        </span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {workshop.announcement}
      </div>
    </div>
  );
}
