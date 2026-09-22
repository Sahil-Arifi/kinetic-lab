import { Icon } from './Icon';

interface Props {
  playing: boolean;
  ready: boolean;
  gravity: number;
  canUndo: boolean;
  canRedo: boolean;
  onToggle: () => void;
  onStep: () => void;
  onReset: () => void;
  onGravity: (value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}
export function WorkshopToolbar(props: Props) {
  return (
    <header className="toolbar">
      <a className="brand" href="#workbench" aria-label="Kinetic Lab workbench">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          KINETIC<span className="brand-light"> / LAB</span>
        </span>
      </a>
      <div className="playback-controls" role="group" aria-label="Simulation playback">
        <button
          className="play-button"
          onClick={props.onToggle}
          disabled={!props.ready}
          aria-label={props.playing ? 'Pause' : 'Play'}
        >
          <Icon name={props.playing ? 'pause' : 'play'} />
          <span>{props.playing ? 'Pause' : 'Play'}</span>
        </button>
        <button
          className="icon-button"
          aria-label="Single step"
          title="Advance one 1/120 second tick"
          disabled={!props.ready || props.playing}
          onClick={props.onStep}
        >
          <Icon name="step" />
        </button>
        <button
          className="icon-button"
          aria-label="Reset scene"
          title="Reset to authored scene"
          disabled={!props.ready}
          onClick={props.onReset}
        >
          <Icon name="reset" />
        </button>
      </div>
      <div className="toolbar-rule" />
      <label className="gravity-control">
        <span>GRAVITY</span>
        <input
          type="range"
          min="-20"
          max="0"
          step="0.01"
          aria-label="Gravity (m/s²)"
          value={props.gravity}
          onChange={(event) => props.onGravity(Number(event.target.value))}
        />
        <output>
          {Math.abs(props.gravity).toFixed(2)} <small>m/s²</small>
        </output>
      </label>
      <div className="history-controls" role="group" aria-label="Scene edit history">
        <button
          className="icon-button"
          disabled={!props.canUndo}
          aria-label="Undo scene edit"
          title="Undo scene edit"
          onClick={props.onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-button"
          disabled={!props.canRedo}
          aria-label="Redo scene edit"
          title="Redo scene edit"
          onClick={props.onRedo}
        >
          <Icon name="redo" />
        </button>
      </div>
      <div className="toolbar-meta">
        <span className="status-dot" /> LOCAL PHYSICS
      </div>
    </header>
  );
}
