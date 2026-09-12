// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessibleObjectList } from '../../src/components/AccessibleObjectList';
import { ObjectInspector } from '../../src/components/ObjectInspector';
import { WorkshopToolbar } from '../../src/components/WorkshopToolbar';
import type { BodyDocument } from '../../src/engine/scene-schema';

afterEach(cleanup);
const body: BodyDocument = {
  id: 'marble',
  name: 'Marble',
  type: 'sphere',
  bodyMode: 'dynamic',
  position: { x: 0, y: 2, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  dimensions: { x: 0.5, y: 0.5, z: 0.5 },
  mass: 1,
  friction: 0.5,
  restitution: 0.1,
};

describe('accessible authored-scene controls', () => {
  it('selects an object using only keyboard DOM controls', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AccessibleObjectList bodies={[body]} selectedId={null} onSelect={onSelect} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Marble/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('marble');
  });

  it('commits valid numeric edits and rejects invalid mass without mutating the authored body', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <ObjectInspector
        body={body}
        playing={false}
        onUpdate={onUpdate}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const mass = screen.getByRole('spinbutton', { name: 'Mass (kg)' });
    await user.clear(mass);
    await user.type(mass, '-1');
    await user.tab();
    expect(mass).toHaveAttribute('aria-invalid', 'true');
    expect(onUpdate).not.toHaveBeenCalled();
    await user.clear(mass);
    await user.type(mass, '2.5{Enter}');
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('marble', { mass: 2.5 });
    expect(body.mass).toBe(1);
  });

  it('cancels a draft field edit with Escape', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <ObjectInspector
        body={body}
        playing={false}
        onUpdate={onUpdate}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const position = screen.getByRole('spinbutton', { name: 'Position X' });
    await user.clear(position);
    await user.type(position, '3');
    await user.keyboard('{Escape}');
    expect(position).toHaveValue(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('blocks authored edits while the simulation is playing', () => {
    render(
      <ObjectInspector
        body={body}
        playing
        onUpdate={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    for (const field of screen.getAllByRole('spinbutton')) expect(field).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Duplicate selected object' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete selected object' })).toBeDisabled();
  });

  it('exposes labeled playback controls with state-correct single-step availability', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const props = {
      playing: false,
      ready: true,
      gravity: -9.81,
      canUndo: false,
      canRedo: false,
      onToggle,
      onStep: vi.fn(),
      onReset: vi.fn(),
      onGravity: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    };
    const { rerender } = render(<WorkshopToolbar {...props} />);
    expect(screen.getByRole('button', { name: 'Single step' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<WorkshopToolbar {...props} playing />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Single step' })).toBeDisabled();
  });
});
