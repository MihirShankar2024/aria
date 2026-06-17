import type { Duration, Measure, NoteEvent, TimeSig, VoiceNumber } from '../types/score'

const QUARTER_BEATS: Record<Duration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
}

/** Beat duration of one note/rest event, expressed in quarter-note beats. */
export function noteBeatDuration(event: Pick<NoteEvent, 'duration' | 'dots'>): number {
  return QUARTER_BEATS[event.duration] * (event.dots > 0 ? 1.5 : 1)
}

/**
 * How many quarter-note beats fit in one measure for a given time signature.
 *   4/4  → 4    3/4 → 3    6/8 → 3    2/2 → 4    12/8 → 6
 */
export function measureCapacity(timeSig: TimeSig): number {
  return (timeSig.beats / timeSig.beatType) * 4
}

/** Events belonging to one voice, in document order. */
export function voiceEvents(measure: Measure, voice: VoiceNumber): NoteEvent[] {
  return measure.notes.filter(n => n.voice === voice)
}

/**
 * Total quarter-note beats currently occupied in a measure. With `voice`, counts
 * only that voice's events; without it, the whole measure (legacy single-timeline).
 */
export function measureBeatCount(measure: Measure, voice?: VoiceNumber): number {
  const evs = voice ? voiceEvents(measure, voice) : measure.notes
  return evs.reduce((sum, n) => sum + noteBeatDuration(n), 0)
}

/** Remaining quarter-note beat capacity in the measure (optionally for one voice). */
export function measureRemainingBeats(measure: Measure, timeSig: TimeSig, voice?: VoiceNumber): number {
  return measureCapacity(timeSig) - measureBeatCount(measure, voice)
}

/** True when the measure (or one voice) is exactly full (ε=0.001 tolerance). */
export function isMeasureFull(measure: Measure, timeSig: TimeSig, voice?: VoiceNumber): boolean {
  return Math.abs(measureBeatCount(measure, voice) - measureCapacity(timeSig)) < 0.001
}

/** True when a new event with the given duration/dots fits in the remaining space
 *  (optionally checked against one voice's remaining capacity). */
export function noteCanFit(
  measure: Measure,
  event: Pick<NoteEvent, 'duration' | 'dots'>,
  timeSig: TimeSig,
  voice?: VoiceNumber,
): boolean {
  return noteBeatDuration(event) <= measureRemainingBeats(measure, timeSig, voice) + 0.001
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
