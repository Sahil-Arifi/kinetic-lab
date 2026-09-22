// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boundedDragTarget, clampDepth, clampVec3, pointerToNdc } from '../../src/input/pointer';
import { isPrimaryInteraction, resolvePointerIntent } from '../../src/input/touch';
import { isEditableTarget, resolveKeyboardAction } from '../../src/input/keyboard';

describe('pointer coordinates and bounds', () => {
  it('maps DOM coordinates into bounded canvas coordinates', () => {
    const bounds = { left: 10, top: 20, width: 100, height: 200 };
    expect(pointerToNdc(10, 20, bounds)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(60, 120, bounds)).toEqual({ x: 0, y: 0 });
    expect(pointerToNdc(110, 220, bounds)).toEqual({ x: 1, y: -1 });
    expect(pointerToNdc(-100, 1000, bounds)).toEqual({ x: -1, y: -1 });
    expect(() => pointerToNdc(1, 1, { ...bounds, width: 0 })).toThrow();
    expect(() => pointerToNdc(1, 1, { ...bounds, height: -1 })).toThrow();
    expect(() => pointerToNdc(Infinity, 1, bounds)).toThrow();
  });

  it('clamps explicit drag depth and every world coordinate', () => {
    expect(clampDepth(20)).toBe(5);
    expect(clampDepth(-20)).toBe(-5);
    expect(clampDepth(2)).toBe(2);
    expect(clampVec3({ x: 9, y: -8, z: 1 }, { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }))
      .toEqual({ x: 2, y: -2, z: 1 });
    expect(clampVec3({ x: 9, y: -8, z: 1 }, -2, 2)).toEqual({ x: 2, y: -2, z: 1 });
    expect(() => clampDepth(NaN)).toThrow();
    expect(() => clampDepth(0, 3, 1)).toThrow();
  });

  it('bounds 3D handle speed including diagonal motion and zero elapsed time', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const target = { x: 3, y: 4, z: 0 };
    expect(boundedDragTarget(origin, target, 2, 1)).toEqual({ x: 1.2000000000000002, y: 1.6, z: 0 });
    expect(boundedDragTarget(origin, target, 10, 1)).toEqual(target);
    expect(boundedDragTarget(origin, origin, 0, 0)).toEqual(origin);
    expect(boundedDragTarget(origin, target, 0, 1)).toEqual(origin);
    expect(boundedDragTarget(origin, target, 10, 0)).toEqual(origin);
    expect(() => boundedDragTarget(origin, target, -1, 1)).toThrow();
    expect(() => boundedDragTarget(origin, target, 1, -1)).toThrow();
    expect(() => boundedDragTarget(origin, { ...target, z: NaN }, 1, 1)).toThrow();
    expect(() => boundedDragTarget(origin, target, Number.MAX_VALUE, 2)).toThrow();
    expect(() => boundedDragTarget({ ...origin, x: -Number.MAX_VALUE }, { ...target, x: Number.MAX_VALUE }, 1, 1)).toThrow();
  });
});

describe('single pointer touch and mouse modes', () => {
  it('honors explicit camera mode and supports one-finger object interaction', () => {
    expect(resolvePointerIntent('touch', 'orbit', true)).toBe('orbit');
    expect(resolvePointerIntent('mouse', 'object', true)).toBe('grab');
    expect(resolvePointerIntent('touch', 'object', true)).toBe('grab');
    expect(resolvePointerIntent('touch', 'object', false)).toBe('select');
    expect(resolvePointerIntent('mouse', 'object', false)).toBe('orbit');
  });

  it('ignores secondary pointers and non-primary mouse buttons', () => {
    expect(isPrimaryInteraction({ isPrimary: true, pointerType: 'touch', button: -1 })).toBe(true);
    expect(isPrimaryInteraction({ isPrimary: true, pointerType: 'mouse', button: 0 })).toBe(true);
    expect(isPrimaryInteraction({ isPrimary: true, pointerType: 'pen', button: 0 })).toBe(true);
    expect(isPrimaryInteraction({ isPrimary: false, pointerType: 'touch', button: 0 })).toBe(false);
    expect(isPrimaryInteraction({ isPrimary: true, pointerType: 'mouse', button: 2 })).toBe(false);
  });
});

describe('keyboard commands', () => {
  it('handles playback, cancellation and unrelated keys', () => {
    expect(resolveKeyboardAction({ key: ' ', target: document.body })).toBe('togglePlayback');
    expect(resolveKeyboardAction({ key: ' ', target: null })).toBe('togglePlayback');
    expect(resolveKeyboardAction({ key: 'Escape', target: document.createElement('input') })).toBe('cancelGrab');
    expect(resolveKeyboardAction({ key: 'a', target: null })).toBeNull();
  });

  it.each(['input', 'textarea', 'select'])('leaves %s editing undisturbed', (tag) => {
    const target = document.createElement(tag);
    expect(isEditableTarget(target)).toBe(true);
    expect(resolveKeyboardAction({ key: ' ', target })).toBeNull();
  });

  it('respects contenteditable descendants, ARIA textboxes, and native button activation', () => {
    const parent = document.createElement('div');
    parent.contentEditable = 'true';
    parent.setAttribute('contenteditable', 'true');
    const child = parent.appendChild(document.createElement('span'));
    expect(isEditableTarget(child)).toBe(true);
    parent.setAttribute('contenteditable', 'false');
    expect(isEditableTarget(child)).toBe(false);
    parent.setAttribute('role', 'textbox');
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    const button = document.createElement('button');
    const label = button.appendChild(document.createElement('span'));
    expect(resolveKeyboardAction({ key: ' ', target: label })).toBeNull();
    const link = document.createElement('a');
    link.href = '/';
    expect(resolveKeyboardAction({ key: ' ', target: link })).toBeNull();
  });

  it.each(['defaultPrevented', 'repeat', 'altKey', 'ctrlKey', 'metaKey'] as const)(
    'ignores %s keyboard events', (flag) => {
      expect(resolveKeyboardAction({ key: ' ', target: null, [flag]: true })).toBeNull();
    },
  );
});
