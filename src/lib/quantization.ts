import type { PitchEvent } from '../types/audio'
import type { Duration, Note, Pitch, TimeSig } from '../types/score'
import { midiToPitch } from './vexflow/renderer'

const DURATION_BEATS: Record<Duration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
}

const DURATION_ORDER: Duration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth']

function nearestDuration(beats: number): Duration {
  let best: Duration = 'quarter'
  let minDiff = Infinity
  for (const dur of DURATION_ORDER) {
    const diff = Math.abs(DURATION_BEATS[dur] - beats)
    if (diff < minDiff) { minDiff = diff; best = dur }
  }
  return best
}

export function quantizeTiming(
  events: PitchEvent[],
  timeSig: TimeSig,
  tempo: number,
): Note[] {
  const secondsPerBeat = 60 / tempo
  return events
    .filter(e => e.amplitude >= 0.3)
    .map(e => {
      const durationSeconds = e.endTime - e.startTime
      const durationBeats = durationSeconds / secondsPerBeat
      const duration = nearestDuration(durationBeats / (4 / timeSig.beatType))
      const pitch: Pitch = midiToPitch(e.midiNote)
      return {
        id: crypto.randomUUID(),
        type: 'note' as const,
        pitches: [pitch],
        duration,
        dots: 0,
        tied: false,
        voice: 1 as const,
      }
    })
}
