import { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } from '@spotify/basic-pitch'
import type { PitchEvent } from '../types/audio'

// Model is loaded once per worker lifetime
const model = new BasicPitch('https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json')

self.onmessage = async (e: MessageEvent<Float32Array>) => {
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []

  await model.evaluateModel(
    e.data,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    (progress: number) => {
      self.postMessage({ type: 'progress', progress })
    },
  )

  const rawNotes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.5, 0.3, undefined, false, undefined, undefined, false),
    ),
  )

  const pitchEvents: PitchEvent[] = rawNotes.map(n => ({
    midiNote: n.pitchMidi,
    startTime: n.startTimeSeconds,
    endTime: n.durationSeconds + n.startTimeSeconds,
    amplitude: n.amplitude,
  }))

  self.postMessage({ type: 'result', pitchEvents })
}
