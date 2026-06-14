import type { Duration, Measure, NoteEvent, TimeSig } from '../types/score'

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

/** Total quarter-note beats currently occupied in a measure. */
export function measureBeatCount(measure: Measure): number {
  return measure.notes.reduce((sum, n) => sum + noteBeatDuration(n), 0)
}

/** Remaining quarter-note beat capacity in the measure. */
export function measureRemainingBeats(measure: Measure, timeSig: TimeSig): number {
  return measureCapacity(timeSig) - measureBeatCount(measure)
}

/** True when the measure is exactly full (ε=0.001 tolerance for float arithmetic). */
export function isMeasureFull(measure: Measure, timeSig: TimeSig): boolean {
  return Math.abs(measureBeatCount(measure) - measureCapacity(timeSig)) < 0.001
}

/** True when a new event with the given duration/dots fits in the remaining space. */
export function noteCanFit(
  measure: Measure,
  event: Pick<NoteEvent, 'duration' | 'dots'>,
  timeSig: TimeSig,
): boolean {
  return noteBeatDuration(event) <= measureRemainingBeats(measure, timeSig) + 0.001
}
