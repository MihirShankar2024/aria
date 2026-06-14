import type { Measure, Tie } from '../types/score'

/**
 * Turn a drag from one note to another into tie/slur spans.
 *
 * The dragged range covers every event between the two endpoints (inclusive),
 * in document order across measures. Rests break continuity (a tie/slur can't
 * sound through silence), so the range is split into maximal runs of adjacent
 * notes; each run of two or more notes yields one span (first → last note).
 * Single-note runs yield nothing. Drag direction doesn't matter — endpoints are
 * normalised to document order.
 */
export function computeTieSpans(measures: Measure[], idA: string, idB: string): Tie[] {
  const flat = measures.flatMap(m => m.notes)
  const i = flat.findIndex(e => e.id === idA)
  const j = flat.findIndex(e => e.id === idB)
  if (i === -1 || j === -1 || i === j) return []

  const [lo, hi] = i < j ? [i, j] : [j, i]
  const ties: Tie[] = []
  let run: string[] = []

  const flush = () => {
    if (run.length >= 2) {
      ties.push({ id: crypto.randomUUID(), from: run[0], to: run[run.length - 1] })
    }
    run = []
  }

  for (let k = lo; k <= hi; k++) {
    const ev = flat[k]
    if (ev.type === 'note') run.push(ev.id)
    else flush() // rest ends the current run
  }
  flush()
  return ties
}
