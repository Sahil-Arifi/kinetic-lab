export type InteractionMode = 'object' | 'orbit';
export type PointerIntent = 'grab' | 'orbit' | 'select';

/** A single touch can either manipulate objects or orbit via the visible mode control. */
export function resolvePointerIntent(pointerType: string, mode: InteractionMode, hasDynamicBody: boolean): PointerIntent {
  if (mode === 'orbit') return 'orbit';
  if (hasDynamicBody) return 'grab';
  return pointerType === 'touch' ? 'select' : 'orbit';
}

export function isPrimaryInteraction(event: { isPrimary: boolean; button: number; pointerType: string }): boolean {
  return event.isPrimary && (event.pointerType === 'touch' || event.button === 0);
}
