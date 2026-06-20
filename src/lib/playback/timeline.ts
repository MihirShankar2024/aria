import type { Score, NoteEvent, Tuplet } from '../../types/score'
import type { MeasureGeometry, NoteGeometry } from '../vexflow/renderer'
import { effectiveTimeSigAt, eventBeats, measureCapacity } from '../beats'

export interface PlaybackLayout {
  measures: MeasureGeometry[]
  notes: NoteGeometry[]
}

export interface PlaybackTimelinePoint {
  time: number
  x: number
}

function getEffectiveTempo(score: Score, measureNumber: number): number {
  let tempo = score.tempo
  for (const tc of score.tempoChanges) {
    if (tc.measureNumber <= measureNumber) tempo = tc.tempo
    else break
  }
  return tempo
}

// Sounded seconds for an event, including any tuplet scaling (tuplet members sound shorter
// than their written value, so the timeline must use the scaled beat count).
function eventDurationSeconds(event: NoteEvent, tempo: number, tuplets?: Tuplet[]): number {
  return eventBeats(event, tuplets) * (60 / tempo)
}

/** Map transport time (seconds) to a horizontal scroll x using the last event at/before t. */
export function xAtTime(points: PlaybackTimelinePoint[], t: number): number {
  let x = 0
  for (const p of points) {
    if (p.time > t) break
    x = p.x
  }
  return x
}

/**
 * Build a time → x timeline from the first part's rhythm and rendered note positions.
 * Measure widths are system-aligned, so any staff's geometry works.
 */
export function buildPlaybackTimeline(score: Score, layout: PlaybackLayout): PlaybackTimelinePoint[] {
  const part = score.parts[0]
  if (!part) return [{ time: 0, x: 0 }]

  const noteById = new Map(layout.notes.map(n => [n.id, n]))
  const measureCount = Math.max(...score.parts.map(p => p.measures.length))
  const points: PlaybackTimelinePoint[] = [{ time: 0, x: 0 }]
  let absTime = 0

  for (let mIdx = 0; mIdx < measureCount; mIdx++) {
    const timeSig = effectiveTimeSigAt(score.parts[0]?.measures ?? [], mIdx, score.globalTimeSig)
    const measure = part.measures[mIdx]
    const measureNum = measure?.number ?? (mIdx + 1)
    const tempo = getEffectiveTempo(score, measureNum)
    const measureGeom = layout.measures[mIdx]
    const fallbackX = measureGeom?.x ?? 0

    // Quarter-note beats per bar (NOT timeSig.beats — that's the numerator, eighths in 6/8).
    const measureDuration = measureCapacity(timeSig) * (60 / tempo)
    const measureStart = absTime
    if (measure && measure.notes.length > 0) {
      // The playhead is a single cursor, but voices are independent timelines that each
      // restart at the barline (mirroring the audio scheduler). Walking measure.notes
      // linearly would sum BOTH voices and over-advance — fatal for true polyrhythms.
      // Track one voice's onsets (voices stack vertically at the same x, so one suffices)
      // from measureStart, keeping the time→x points monotonic for xAtTime.
      const primaryVoice = ([1, 2] as const).find(v => measure.notes.some(n => n.voice === v)) ?? 1
      let voiceTime = measureStart
      for (const event of measure.notes) {
        if (event.voice !== primaryVoice) continue
        const geom = noteById.get(event.id)
        points.push({ time: voiceTime, x: geom?.cx ?? fallbackX })
        voiceTime += eventDurationSeconds(event, tempo, measure.tuplets)
      }
    } else {
      points.push({ time: measureStart, x: fallbackX })
    }
    // Always snap to the barline so parts/voices stay aligned regardless of fill.
    absTime = measureStart + measureDuration
  }

  return points
}
