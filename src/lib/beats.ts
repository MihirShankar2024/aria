import type { Duration, Measure, NoteEvent, TimeSig, Tuplet, VoiceNumber } from '../types/score'
import { type Rational, r, add, mul, div, toFloat, equals, lte, gcd } from './rational'

const QUARTER_BEATS: Record<Duration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
}

// Same values as QUARTER_BEATS but exact, for rational accumulation.
const QUARTER_BEATS_R: Record<Duration, Rational> = {
  whole: r(4),
  half: r(2),
  quarter: r(1),
  eighth: r(1, 2),
  sixteenth: r(1, 4),
}

/** Beat duration of one note/rest event, expressed in quarter-note beats. */
export function noteBeatDuration(event: Pick<NoteEvent, 'duration' | 'dots'>): number {
  return QUARTER_BEATS[event.duration] * (event.dots > 0 ? 1.5 : 1)
}

/** Exact written beat duration of one event, ignoring any tuplet scaling. */
function writtenBeatsR(event: Pick<NoteEvent, 'duration' | 'dots'>): Rational {
  const base = QUARTER_BEATS_R[event.duration]
  return event.dots > 0 ? mul(base, r(3, 2)) : base
}

/**
 * Printed tuplet number, which can differ from the stored `played`. `played:inSpaceOf` is
 * the immutable time scale (it drives playback and beat math), but the *number drawn over
 * the bracket* should match the notes actually present. A 6:4 quarter tuplet draws "6"
 * while it holds six quarter slots, but once filled with three half notes the bracket only
 * spans three equal notes, so it should read "3" (a 3:2 at the half-note level).
 *
 * Rule: measure every member's written length in base-unit slots (one slot = total written
 * content / `played`). When every member spans a whole number of slots, reduce
 * `played:inSpaceOf` by the GCD of those slot counts; a clean larger-value fill collapses the
 * number (3 halves → 3) while a mixed fill (halves + quarters) reduces to GCD 1 and keeps the
 * original count. Members spanning a fractional slot (a value finer than the base unit) can't
 * reduce, so the stored ratio is returned unchanged.
 */
export function displayTupletRatio(
  def: Pick<Tuplet, 'played' | 'inSpaceOf'>,
  members: Pick<NoteEvent, 'duration' | 'dots'>[],
): { played: number; inSpaceOf: number } {
  const original = { played: def.played, inSpaceOf: def.inSpaceOf }
  if (members.length === 0) return original
  const totalWritten = members.reduce<Rational>((s, m) => add(s, writtenBeatsR(m)), r(0))
  if (totalWritten.num === 0) return original
  const baseUnit = mul(totalWritten, r(1, def.played)) // quarter-beats per slot
  let g = def.inSpaceOf
  for (const m of members) {
    const slots = div(writtenBeatsR(m), baseUnit)
    if (slots.den !== 1) return original // a member finer than one slot — can't reduce
    g = gcd(g, slots.num)
  }
  return { played: def.played / g, inSpaceOf: def.inSpaceOf / g }
}

/**
 * Combined time scale a tuplet applies, walking up the `parentId` chain so nested
 * tuplets compose. A 3:2 tuplet scales each member by 2/3; a 3:2 inside another 3:2
 * scales by 4/9.
 */
export function tupletScale(tuplet: Tuplet, tuplets: Tuplet[]): Rational {
  let scale = r(tuplet.inSpaceOf, tuplet.played)
  let parentId = tuplet.parentId
  const seen = new Set<string>([tuplet.id])
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = tuplets.find(t => t.id === parentId)
    if (!parent) break
    scale = mul(scale, r(parent.inSpaceOf, parent.played))
    parentId = parent.parentId
  }
  return scale
}

/**
 * The INNERMOST tuplet that contains `eventId`, or undefined. `tupletScale` composes from here
 * UP the parent chain, so this must return the deepest group — the one that is not the parent of
 * any other group also containing the event. Returning an outer group instead would drop every
 * nested level's scaling (the outer has no parent to walk up to), mis-timing nested tuplets.
 */
function tupletForEvent(eventId: string, tuplets?: Tuplet[]): Tuplet | undefined {
  const containing = tuplets?.filter(t => t.memberIds.includes(eventId))
  if (!containing || containing.length === 0) return undefined
  return containing.find(t => !containing.some(o => o.parentId === t.id)) ?? containing[0]
}

/** Exact sounded beat duration of an event, including any (possibly nested) tuplet scaling. */
export function eventBeatsR(event: NoteEvent, tuplets?: Tuplet[]): Rational {
  const written = writtenBeatsR(event)
  const t = tupletForEvent(event.id, tuplets)
  return t ? mul(written, tupletScale(t, tuplets!)) : written
}

/** Sounded beat duration of an event (float), including tuplet scaling. */
export function eventBeats(event: NoteEvent, tuplets?: Tuplet[]): number {
  return toFloat(eventBeatsR(event, tuplets))
}

/**
 * How many quarter-note beats fit in one measure for a given time signature.
 *   4/4  → 4    3/4 → 3    6/8 → 3    2/2 → 4    12/8 → 6
 */
export function measureCapacity(timeSig: TimeSig): number {
  return (timeSig.beats / timeSig.beatType) * 4
}

/** Exact measure capacity in quarter-note beats. */
export function measureCapacityR(timeSig: TimeSig): Rational {
  return r(timeSig.beats * 4, timeSig.beatType)
}

/** Events belonging to one voice, in document order. */
export function voiceEvents(measure: Measure, voice: VoiceNumber): NoteEvent[] {
  return measure.notes.filter(n => n.voice === voice)
}

/** Exact total sounded beats in a measure (optionally one voice), tuplet-aware. */
export function measureBeatsR(measure: Measure, voice?: VoiceNumber): Rational {
  const evs = voice ? voiceEvents(measure, voice) : measure.notes
  return evs.reduce<Rational>((sum, n) => add(sum, eventBeatsR(n, measure.tuplets)), r(0))
}

/**
 * Total quarter-note beats currently occupied in a measure. With `voice`, counts
 * only that voice's events; without it, the whole measure (legacy single-timeline).
 * Tuplet members are counted at their sounded (scaled) duration.
 */
export function measureBeatCount(measure: Measure, voice?: VoiceNumber): number {
  return toFloat(measureBeatsR(measure, voice))
}

/** Remaining quarter-note beat capacity in the measure (optionally for one voice). */
export function measureRemainingBeats(measure: Measure, timeSig: TimeSig, voice?: VoiceNumber): number {
  return measureCapacity(timeSig) - measureBeatCount(measure, voice)
}

/** True when the measure (or one voice) is exactly full. Exact via rational arithmetic. */
export function isMeasureFull(measure: Measure, timeSig: TimeSig, voice?: VoiceNumber): boolean {
  return equals(measureBeatsR(measure, voice), measureCapacityR(timeSig))
}

/** True when a new event with the given duration/dots fits in the remaining space
 *  (optionally checked against one voice's remaining capacity). The candidate is treated
 *  as a plain (non-tuplet) event; tuplet members are added via CREATE_TUPLET, not here. */
export function noteCanFit(
  measure: Measure,
  event: Pick<NoteEvent, 'duration' | 'dots'>,
  timeSig: TimeSig,
  voice?: VoiceNumber,
): boolean {
  const after = add(measureBeatsR(measure, voice), writtenBeatsR(event))
  return lte(after, measureCapacityR(timeSig))
}

/**
 * Effective time signature for the measure at `index`, propagating the most recent
 * explicit change forward: a measure without its own `timeSig` inherits from the last
 * measure that set one, falling back to `global`. Mirrors standard notation, where a
 * time-signature change persists until the next change.
 */
export function effectiveTimeSigAt(measures: Measure[], index: number, global: TimeSig): TimeSig {
  for (let i = index; i >= 0; i--) {
    if (measures[i]?.timeSig) return measures[i].timeSig!
  }
  return global
}

/** Voices that currently have at least one event, ascending. */
export function occupiedVoices(measure: Measure): VoiceNumber[] {
  const present = new Set<VoiceNumber>(measure.notes.map(n => n.voice))
  return ([1, 2] as VoiceNumber[]).filter(v => present.has(v))
}

/** Occupied voices whose content does not exactly fill the measure (for the red indicator). */
export function incompleteVoices(measure: Measure, timeSig: TimeSig): VoiceNumber[] {
  return occupiedVoices(measure).filter(v => !isMeasureFull(measure, timeSig, v))
}
