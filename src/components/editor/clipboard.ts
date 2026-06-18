import type { NoteEvent } from '../../types/score'

// Module-level clipboard for copy/paste of selected notes. Kept out of score state so
// copying doesn't churn undo history, and shared across every staff canvas (the staff
// the cursor is in handles the paste).
let clipboard: NoteEvent[] = []

export function setClipboard(events: NoteEvent[]): void {
  clipboard = events
}

export function getClipboard(): NoteEvent[] {
  return clipboard
}

// Deep-clone clipboard events with fresh event + pitch ids, so each paste produces
// independent notes (repeated pastes never share an id, and ties/selection keys stay
// unique). Pitch.id must be regenerated too since it keys tie endpoints.
export function cloneWithFreshIds(events: NoteEvent[]): NoteEvent[] {
  return events.map(ev =>
    ev.type === 'note'
      ? { ...ev, id: crypto.randomUUID(), pitches: ev.pitches.map(p => ({ ...p, id: crypto.randomUUID() })) }
      : { ...ev, id: crypto.randomUUID() },
  )
}
