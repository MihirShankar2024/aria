import type { Duration, NoteEvent, Rest, TimeSig } from '../types/score'
import { measureCapacity, noteBeatDuration } from './beats'

/**
 * Beat-aware rest grouping engine.
 *
 * Replaces runs of consecutive rests with the canonical set of rest symbols that
 * REVEALS the beat structure (per docs/notation-engraving-spec.md): combine rests
 * within a beat, never across a stronger beat boundary, dotted rests only in
 * compound meter. See `normalizeMeasureRests` for the entry point.
 *
 * All arithmetic is done in SIXTEENTH units (integers) to avoid float drift:
 * a quarter note = 4 units, an eighth = 2, a sixteenth = 1.
 */

const U = 4 // sixteenth units per quarter-beat

// Rest symbol for an exact duration in sixteenth units.
// Dotted entries (3, 6, 12) are only emitted in compound meter.
const REST_BY_UNITS: Record<number, { duration: Duration; dots: number }> = {
  16: { duration: 'whole', dots: 0 },
  12: { duration: 'half', dots: 1 },
  8: { duration: 'half', dots: 0 },
  6: { duration: 'quarter', dots: 1 },
  4: { duration: 'quarter', dots: 0 },
  3: { duration: 'eighth', dots: 1 },
  2: { duration: 'eighth', dots: 0 },
  1: { duration: 'sixteenth', dots: 0 },
}
const DOTTED_UNITS = new Set([12, 6, 3])

function isCompound(timeSig: TimeSig): boolean {
  return timeSig.beatType === 8 && timeSig.beats % 3 === 0 && timeSig.beats >= 6
}

function isRepresentable(units: number, compound: boolean): boolean {
  if (!(units in REST_BY_UNITS)) return false
  if (compound) {
    // Compound meter allows dotted values, but a rest may never be longer than
    // one dotted-quarter beat — rests fill beat-by-beat so the compound pulse
    // (the 3+3 grouping) stays visible. So {dotted-quarter, quarter, dotted-eighth, eighth, sixteenth}.
    return units <= 6
  }
  // Simple meter: no dotted rest values (they obscure beat location).
  return !DOTTED_UNITS.has(units)
}

// How to divide the whole measure into its notated beats.
function beatGroupFactors(nBeats: number): number[] {
  switch (nBeats) {
    case 1: return []
    case 2: return [2]
    case 3: return [3]
    case 4: return [2, 2]
    default: return [nBeats]
  }
}

// How to subdivide one beat down to the sixteenth grid.
function beatSubFactors(beatUnits: number, compound: boolean): number[] {
  if (compound) {
    // dotted-quarter beat (6 units): triple into eighths, then duple to sixteenths
    const factors = [3]
    let len = beatUnits / 3
    while (len > 1) { factors.push(2); len /= 2 }
    return factors
  }
  // simple beat: halve down to the sixteenth grid
  const factors: number[] = []
  let len = beatUnits
  while (len > 1) { factors.push(2); len /= 2 }
  return factors
}

/**
 * Metric grid: maps each boundary position (in sixteenth units) to its level.
 * Lower level = stronger boundary. The measure start is level 0.
 */
function buildGrid(timeSig: TimeSig): { grid: Map<number, number>; capacityUnits: number } {
  const capacityUnits = Math.round(measureCapacity(timeSig) * U)
  const compound = isCompound(timeSig)
  const nBeats = compound ? timeSig.beats / 3 : timeSig.beats
  const beatUnits = capacityUnits / nBeats
  const factors = [...beatGroupFactors(nBeats), ...beatSubFactors(beatUnits, compound)]

  const grid = new Map<number, number>()
  const setMin = (pos: number, level: number) => {
    const cur = grid.get(pos)
    if (cur === undefined || level < cur) grid.set(pos, level)
  }

  const subdivide = (start: number, end: number, fs: number[], level: number) => {
    setMin(start, level)
    if (fs.length === 0) return
    const [f, ...rest] = fs
    const step = (end - start) / f
    for (let k = 0; k < f; k++) subdivide(start + k * step, start + (k + 1) * step, rest, level + 1)
  }
  subdivide(0, capacityUnits, factors, 0)
  return { grid, capacityUnits }
}

// Strongest (lowest-level) grid boundary strictly inside (start, end).
// Ties resolve to the earliest position.
function strongestInterior(
  grid: Map<number, number>,
  start: number,
  end: number,
): { pos: number; level: number } | null {
  let best: { pos: number; level: number } | null = null
  for (const [pos, level] of grid) {
    if (pos <= start || pos >= end) continue
    if (!best || level < best.level || (level === best.level && pos < best.pos)) {
      best = { pos, level }
    }
  }
  return best
}

// Decompose silence over [start, end) (sixteenth units) into canonical rest values.
function notateGap(
  start: number,
  end: number,
  grid: Map<number, number>,
  compound: boolean,
): Array<{ duration: Duration; dots: number }> {
  const span = end - start
  if (span <= 0) return []

  const interior = strongestInterior(grid, start, end)
  const startLevel = grid.get(start) ?? Number.MAX_SAFE_INTEGER

  // A single rest is allowed when its value exists AND it doesn't swallow a
  // boundary stronger than the one it starts on (that would hide a beat).
  if (isRepresentable(span, compound) && (interior === null || interior.level > startLevel)) {
    return [REST_BY_UNITS[span]]
  }

  if (interior !== null) {
    return [
      ...notateGap(start, interior.pos, grid, compound),
      ...notateGap(interior.pos, end, grid, compound),
    ]
  }

  // Fallback (not reachable for standard meters): peel off the largest value.
  for (const units of [16, 12, 8, 6, 4, 3, 2, 1]) {
    if (units <= span && isRepresentable(units, compound)) {
      return [REST_BY_UNITS[units], ...notateGap(start + units, end, grid, compound)]
    }
  }
  return []
}

function makeRest(duration: Duration, dots: number): Rest {
  return { id: crypto.randomUUID(), type: 'rest', duration, dots }
}

/**
 * Rewrite a measure's event list so that every run of consecutive rests is
 * expressed in canonical, beat-revealing form. Notes are preserved untouched
 * (same identity and order); only rest runs are recomputed. Total duration is
 * invariant, so note positions and measure fullness are unchanged.
 */
export function normalizeMeasureRests(notes: NoteEvent[], timeSig: TimeSig): NoteEvent[] {
  const { grid, capacityUnits } = buildGrid(timeSig)
  const compound = isCompound(timeSig)
  const result: NoteEvent[] = []

  let offset = 0 // sixteenth units from measure start
  let i = 0
  while (i < notes.length) {
    const ev = notes[i]
    if (ev.type === 'note') {
      result.push(ev)
      offset += Math.round(noteBeatDuration(ev) * U)
      i++
      continue
    }

    // Maximal run of consecutive rests.
    const runStart = offset
    let j = i
    while (j < notes.length && notes[j].type === 'rest') {
      offset += Math.round(noteBeatDuration(notes[j]) * U)
      j++
    }
    const runEnd = offset

    // Entire-measure silence → a single whole-rest glyph (only when the whole
    // rest's value equals the measure, i.e. capacity of 4 quarter-beats).
    if (runStart === 0 && runEnd === capacityUnits && i === 0 && j === notes.length && capacityUnits === 16) {
      result.push(makeRest('whole', 0))
    } else {
      for (const piece of notateGap(runStart, Math.min(runEnd, capacityUnits), grid, compound)) {
        result.push(makeRest(piece.duration, piece.dots))
      }
    }
    i = j
  }

  return result
}

/**
 * Replace a set of marked events (notes and/or rests) with beat-correct rests
 * IN PLACE, preserving every other note's position. Marked notes become rests of
 * identical duration, then the whole measure's rest runs are re-grouped per the
 * notation rules. Returns the rewritten event list plus the ids of the resulting
 * rests that occupy the marked region (used to highlight them red for an undo-able
 * "confirm collapse" step). Marked rests are folded into that region by overlap.
 */
export function applyRestErase(
  notes: NoteEvent[],
  markedIds: Set<string>,
  timeSig: TimeSig,
): { notes: NoteEvent[]; redRestIds: string[] } {
  // Marked span union, in sixteenth units.
  const spans: Array<[number, number]> = []
  let off = 0
  for (const ev of notes) {
    const dur = Math.round(noteBeatDuration(ev) * U)
    if (markedIds.has(ev.id)) spans.push([off, off + dur])
    off += dur
  }

  // Replace marked notes with placeholder rests of equal duration; keep the rest.
  const intermediate: NoteEvent[] = notes.map(ev =>
    markedIds.has(ev.id) && ev.type === 'note'
      ? makeRest(ev.duration, ev.dots)
      : ev,
  )

  const result = normalizeMeasureRests(intermediate, timeSig)

  // Collect rests whose span intersects the marked union.
  const intersects = (s: number, e: number) => spans.some(([a, b]) => s < b && a < e)
  const redRestIds: string[] = []
  let o = 0
  for (const ev of result) {
    const dur = Math.round(noteBeatDuration(ev) * U)
    if (ev.type === 'rest' && intersects(o, o + dur)) redRestIds.push(ev.id)
    o += dur
  }

  return { notes: result, redRestIds }
}

/**
 * Pad a measure's remaining capacity with rests, then canonicalise.
 *
 * Computes the trailing gap (capacity − occupied), appends plain rests that sum
 * exactly to it (integer sixteenth units, so no float drift), then runs
 * `normalizeMeasureRests` to merge them into the canonical beat-revealing form
 * (e.g. a leftover beat after a half note becomes a half rest, not four 16ths).
 * Returns the input unchanged when the measure is already full (or overfull).
 */
export function fillMeasureWithRests(notes: NoteEvent[], timeSig: TimeSig): NoteEvent[] {
  const occupied = notes.reduce((sum, n) => sum + noteBeatDuration(n), 0)
  let units = Math.round((measureCapacity(timeSig) - occupied) * U)
  if (units <= 0) return notes

  const padded = [...notes]
  for (const u of [16, 8, 4, 2, 1]) {           // whole, half, quarter, eighth, sixteenth
    const { duration, dots } = REST_BY_UNITS[u]
    while (units >= u) { padded.push(makeRest(duration, dots)); units -= u }
  }
  return normalizeMeasureRests(padded, timeSig)
}
