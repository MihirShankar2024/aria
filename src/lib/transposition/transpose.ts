import type { Note, Pitch } from '../../types/score'
import { midiToPitch } from '../vexflow/renderer'
import { getInstrument } from '../instruments'

function pitchToMidi(pitch: Pitch): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const accOffset =
    pitch.accidental === 'sharp' ? 1 :
    pitch.accidental === 'flat' ? -1 :
    pitch.accidental === 'double_sharp' ? 2 :
    pitch.accidental === 'double_flat' ? -2 : 0
  return (pitch.octave + 1) * 12 + base[pitch.step] + accOffset
}

function transposePitch(pitch: Pitch, semitones: number): Pitch {
  return midiToPitch(pitchToMidi(pitch) + semitones)
}

// Convert a concert-pitch note to the written pitch for a transposing instrument.
// e.g. concert C4 → written D4 for Bb trumpet (transposition = +2)
export function concertToWritten(note: Note, instrumentKey: string): Note {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return note
  return { ...note, pitches: note.pitches.map(p => transposePitch(p, instrument.transposition)) }
}

// Convert a written pitch for a transposing instrument back to concert pitch.
export function writtenToConcert(note: Note, instrumentKey: string): Note {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return note
  return { ...note, pitches: note.pitches.map(p => transposePitch(p, -instrument.transposition)) }
}
