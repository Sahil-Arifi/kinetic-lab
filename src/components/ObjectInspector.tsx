import { useRef, useState } from 'react';
import type { BodyDocument, Vec3 } from '../engine/scene-schema';
import { Icon } from './Icon';

function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.01,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  const [invalid, setInvalid] = useState(false);
  const cancelBlur = useRef(false);
  const save = () => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    const number = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(number) ||
      (min !== undefined && number < min) ||
      (max !== undefined && number > max)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (number !== value) onCommit(number);
  };
  return (
    <label className={`number-field ${invalid ? 'field-invalid' : ''}`}>
      <span>{label.replace(/^(Position|Rotation) /, '')}</span>
      <input
        type="number"
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelBlur.current = true;
            setDraft(String(value));
            setInvalid(false);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface Props {
  body: BodyDocument | undefined;
  playing: boolean;
  onUpdate: (id: string, patch: Partial<BodyDocument>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}
export function ObjectInspector({ body, playing, onUpdate, onDuplicate, onDelete }: Props) {
  if (!body)
    return (
      <section className="inspector-properties">
        <h2>Object inspector</h2>
        <p>Select an object from the workbench or list.</p>
      </section>
    );
  const axisField = (kind: 'position' | 'rotation', axis: keyof Vec3) => {
    const value = kind === 'rotation' ? (body.rotation[axis] * 180) / Math.PI : body.position[axis];
    const label = `${kind === 'position' ? 'Position' : 'Rotation'} ${axis.toUpperCase()}`;
    return (
      <NumberField
        key={`${body.id}-${kind}-${axis}-${value}`}
        label={label}
        value={value}
        disabled={playing}
        min={kind === 'position' ? -100 : -360}
        max={kind === 'position' ? 100 : 360}
        step={kind === 'position' ? 0.05 : 1}
        onCommit={(next) =>
          onUpdate(body.id, {
            [kind]: {
              ...body[kind],
              [axis]: kind === 'rotation' ? (next * Math.PI) / 180 : next,
            },
          })
        }
      />
    );
  };
  return (
    <section className="inspector-properties" aria-labelledby="selected-object-heading">
      <div className="selected-header">
        <span className={`selected-glyph object-glyph--${body.type}`} aria-hidden="true" />
        <div>
          <span className="eyebrow">SELECTED OBJECT</span>
          <h2 id="selected-object-heading">{body.name}</h2>
        </div>
        <span className="mode-badge">{body.bodyMode === 'dynamic' ? 'DYNAMIC' : 'FIXED'}</span>
      </div>
      <div className="property-group">
        <h3>
          Position <span>m</span>
        </h3>
        <div className="axis-fields">
          {(['x', 'y', 'z'] as const).map((axis) => axisField('position', axis))}
        </div>
      </div>
      <div className="property-group">
        <h3>
          Rotation <span>deg</span>
        </h3>
        <div className="axis-fields">
          {(['x', 'y', 'z'] as const).map((axis) => axisField('rotation', axis))}
        </div>
      </div>
      <div className="property-group physical-properties">
        <h3>Material</h3>
        {(
          [
            {
              key: 'mass',
              label: 'Mass (kg)',
              min: 0.001,
              max: 1000,
              step: 0.1,
            },
            { key: 'friction', label: 'Friction', min: 0, max: 2, step: 0.05 },
            {
              key: 'restitution',
              label: 'Restitution',
              min: 0,
              max: 1,
              step: 0.05,
            },
          ] as const
        ).map((property) => (
          <NumberField
            key={`${body.id}-${property.key}-${body[property.key]}`}
            label={property.label}
            value={body[property.key]}
            disabled={playing}
            min={property.key === 'mass' && body.bodyMode === 'fixed' ? 0 : property.min}
            max={property.max}
            step={property.step}
            onCommit={(value) => onUpdate(body.id, { [property.key]: value })}
          />
        ))}
      </div>
      <div className="object-actions">
        <button disabled={playing} onClick={onDuplicate} aria-label="Duplicate selected object">
          <Icon name="duplicate" /> Duplicate
        </button>
        <button disabled={playing} onClick={onDelete} aria-label="Delete selected object">
          <Icon name="delete" /> Delete
        </button>
      </div>
      <p className="editor-hint">
        {playing
          ? 'Pause the experiment to edit its initial state.'
          : 'Edits set the initial state. Reset reconstructs this scene.'}
      </p>
    </section>
  );
}
