export type KeyboardAction = 'cancelGrab' | 'togglePlayback' | null;

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

export function resolveKeyboardAction(event: {
  key: string;
  target: EventTarget | null;
  defaultPrevented?: boolean;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): KeyboardAction {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === 'Escape') return 'cancelGrab';
  if (event.key !== ' ' || isEditableTarget(event.target)) return null;
  // Preserve native Space activation for buttons rather than also toggling playback.
  if (event.target instanceof Element && event.target.closest('button, [role="button"], a[href]')) return null;
  return 'togglePlayback';
}
