import type { Measure, Note, Tie } from '../types/score'

/**
 * Build a single tie/slur between two specific noteheads.
 *
 * Each endpoint is one notehead, identified by its event id and the stable `Pitch.id`
 * within that event. The two endpoints are normalised to document order (the earlier
 * event becomes `from`). Tie vs. slur is *not* decided here — the renderer derives it
 * from whether the two heads share a pitch.
 *
 * Returns null if either head can't be found or both endpoints are the same notehead.
 */
export function buildTie(
  measures: Measure[],
  fromNoteId: string,
  fromPitchId: string,
  toNoteId: string,
  toPitchId: string,
): Tie | null {
  if (fromNoteId === toNoteId && fromPitchId === toPitchId) return null

  const flat = measures.flatMap(m => m.notes)
  const findHead = (noteId: string, pitchId: string): boolean => {
    const ev = flat.find(e => e.id === noteId)
    return !!ev && ev.type === 'note' && (ev as Note).pitches.some(p => p.id === pitchId)
  }
  if (!findHead(fromNoteId, fromPitchId) || !findHead(toNoteId, toPitchId)) return null

  const iFrom = flat.findIndex(e => e.id === fromNoteId)
  const iTo = flat.findIndex(e => e.id === toNoteId)
  // Normalise so `from` is the document-earlier endpoint (matches Tie's contract and the
  // renderer/curve-direction assumptions). Same event keeps the given order.
  const swap = iTo < iFrom
  const from = swap ? { note: toNoteId, pitch: toPitchId } : { note: fromNoteId, pitch: fromPitchId }
  const to = swap ? { note: fromNoteId, pitch: fromPitchId } : { note: toNoteId, pitch: toPitchId }

  return { id: crypto.randomUUID(), from, to }
}
