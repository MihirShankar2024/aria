import type { NoteEvent, Pitch } from '../../types/score'

// Per-notehead selection model. Selection sets carry composite keys instead of bare
// event ids, so a chord can be partially selected:
//   - a note pitch  → `"<eventId>#<pitchIndex>"`
//   - a whole event (rest, which has no pitches) → `"<eventId>"`
// `pitchIndex` aligns with `Note.pitches[i]` (and the renderer's `ys[i]`/`xs[i]`).

// A rubber-band selection drag in *client* (viewport) coordinates. Lives in ScoreEditor so a
// single drag can span multiple track canvases; each canvas converts it to its own local space
// via its container rect. `s` = start (mousedown), `c` = current (last pointer position).
export interface SelectionDrag {
  sx: number
  sy: number
  cx: number
  cy: number
}

export function selKey(id: string, pitchIndex?: number): string {
  return pitchIndex === undefined ? id : `${id}#${pitchIndex}`
}

export function parseSelKey(key: string): { id: string; pitchIndex: number | null } {
  const hash = key.lastIndexOf('#')
  if (hash < 0) return { id: key, pitchIndex: null }
  return { id: key.slice(0, hash), pitchIndex: Number(key.slice(hash + 1)) }
}

// Group a selection set by event id. The value is the set of selected pitch indices,
// or 'all' for a whole-event key (a selected rest).
export function selectionByEvent(sel: Set<string>): Map<string, Set<number> | 'all'> {
  const map = new Map<string, Set<number> | 'all'>()
  for (const key of sel) {
    const { id, pitchIndex } = parseSelKey(key)
    if (pitchIndex === null) { map.set(id, 'all'); continue }
    const existing = map.get(id)
    if (existing === 'all') continue
    const set = existing ?? new Set<number>()
    set.add(pitchIndex)
    map.set(id, set)
  }
  return map
}

// Whether a specific notehead is selected.
export function isPitchSelected(byEvent: Map<string, Set<number> | 'all'>, id: string, pitchIndex: number): boolean {
  const sel = byEvent.get(id)
  return sel === 'all' || (sel instanceof Set && sel.has(pitchIndex))
}

// Apply `fn` to only the selected pitches of each event, preserving pitch order so
// indices stay stable across edits. Notes with no selected pitches are untouched.
export function mapSelectedPitches(
  notes: NoteEvent[],
  byEvent: Map<string, Set<number> | 'all'>,
  fn: (pitch: Pitch) => Pitch,
): NoteEvent[] {
  return notes.map(ev => {
    if (ev.type !== 'note') return ev
    const sel = byEvent.get(ev.id)
    if (!sel) return ev
    // Keep the source notehead id on the transformed pitch so ties/slurs follow the head.
    return { ...ev, pitches: ev.pitches.map((p, i) => (sel === 'all' || sel.has(i) ? { ...fn(p), id: p.id } : p)) }
  })
}

const STEP_ORDER: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
// Staff-line rank (low→high). Accidentals don't change line position, so diatonic
// order is what rendering uses; ties between same-line pitches keep input order.
const pitchRank = (p: Pitch) => p.octave * 7 + STEP_ORDER[p.step]

// Like `mapSelectedPitches`, but re-sorts each touched chord low→high afterwards and
// reports the new composite keys for the moved heads (their indices shift on sort).
// Use when a transform can reorder pitches (a per-head move/transpose) so the stored
// array stays canonical and the selection keeps tracking the same physical heads.
export function moveSelectedPitches(
  notes: NoteEvent[],
  byEvent: Map<string, Set<number> | 'all'>,
  fn: (pitch: Pitch) => Pitch,
): { notes: NoteEvent[]; newKeys: string[] } {
  const newKeys: string[] = []
  const out = notes.map(ev => {
    const sel = byEvent.get(ev.id)
    if (!sel) return ev
    if (ev.type !== 'note') { newKeys.push(ev.id); return ev }  // selected rest stays selected
    const tagged = ev.pitches.map((p, i) => {
      const selected = sel === 'all' || sel.has(i)
      // Keep the source notehead id on the transformed pitch so ties/slurs follow the head.
      return { pitch: selected ? { ...fn(p), id: p.id } : p, selected }
    })
    tagged.sort((a, b) => pitchRank(a.pitch) - pitchRank(b.pitch))
    tagged.forEach((t, i) => { if (t.selected) newKeys.push(selKey(ev.id, i)) })
    return { ...ev, pitches: tagged.map(t => t.pitch) }
  })
  return { notes: out, newKeys }
}

// Remove selected noteheads: drop selected rests; strip selected pitch indices from
// chords; drop any note left with zero pitches. Caller is responsible for re-filling
// rests / shifting the measure afterwards (normalizeMeasureRests).
export function deleteSelectedPitches(
  notes: NoteEvent[],
  byEvent: Map<string, Set<number> | 'all'>,
): NoteEvent[] {
  const out: NoteEvent[] = []
  for (const ev of notes) {
    const sel = byEvent.get(ev.id)
    if (!sel) { out.push(ev); continue }
    if (ev.type !== 'note' || sel === 'all') continue  // rest selected, or whole note removed
    const pitches = ev.pitches.filter((_, i) => !sel.has(i))
    if (pitches.length > 0) out.push({ ...ev, pitches })
    // else: every pitch removed → drop the event entirely
  }
  return out
}
