import type { BodyDocument } from '../engine/scene-schema';
import { Icon } from './Icon';

const primitives: {
  type: BodyDocument['type'];
  label: string;
  glyph: string;
}[] = [
  { type: 'sphere', label: 'Sphere', glyph: 'sphere' },
  { type: 'block', label: 'Block', glyph: 'block' },
  { type: 'domino', label: 'Domino', glyph: 'domino' },
  { type: 'ramp', label: 'Ramp', glyph: 'ramp' },
  { type: 'fixedBarrier', label: 'Barrier', glyph: 'fixedBarrier' },
  { type: 'targetCup', label: 'Cup', glyph: 'targetCup' },
];
export function ObjectTray({
  playing,
  onAdd,
}: {
  playing: boolean;
  onAdd: (type: BodyDocument['type']) => void;
}) {
  return (
    <section className="object-tray" aria-label="Add objects">
      <div className="tray-caption">
        <span className="eyebrow">YOUR EXPERIMENT</span>
        <span>Add a little possibility.</span>
      </div>
      <div className="tray-items">
        {primitives.map(({ type, label, glyph }) => (
          <button
            key={type}
            disabled={playing}
            aria-label={`Add ${label.toLowerCase()}`}
            onClick={() => onAdd(type)}
          >
            <span className={`tray-shape tray-shape--${glyph}`} aria-hidden="true" />
            <span>{label}</span>
            <Icon name="plus" />
          </button>
        ))}
      </div>
      <div className="tray-note">{playing ? 'Pause to build' : 'Click an object to add'}</div>
    </section>
  );
}
