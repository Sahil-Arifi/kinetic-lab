import type { BodyDocument } from '../engine/scene-schema';

export function AccessibleObjectList({
  bodies,
  selectedId,
  onSelect,
}: {
  bodies: BodyDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="object-list-section" aria-labelledby="objects-heading">
      <div className="section-label">
        <h2 id="objects-heading">Objects</h2>
        <span>{bodies.length.toString().padStart(2, '0')}</span>
      </div>
      <ul className="object-list">
        {bodies.map((body) => (
          <li key={body.id}>
            <button aria-pressed={selectedId === body.id} onClick={() => onSelect(body.id)}>
              <span className={`object-glyph object-glyph--${body.type}`} aria-hidden="true" />
              <span>{body.name}</span>
              <span className="body-mode">{body.bodyMode === 'fixed' ? 'FIX' : 'DYN'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
