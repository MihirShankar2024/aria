import type { Note, NoteName, Pitch } from '../../types/score'
import { midiToPitch } from '../vexflow/renderer'
import { getInstrument } from '../instruments'

const LETTERS: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

// Chromatic shift by `semitones`, re-spelling via midi (may introduce sharps/flats).
// Used by arrow-key nudge of selected notes (±1 = half step, ±12 = octave).
export function transposeChromatic(pitch: Pitch, semitones: number): Pitch {
  return transposePitch(pitch, semitones)
}

// Diatonic shift by `steps` staff positions (letter + octave), keeping the
// accidental as-is. Used by drag-move so notes snap to staff lines/spaces.
export function diatonicStep(pitch: Pitch, steps: number): Pitch {
  const abs = pitch.octave * 7 + LETTERS.indexOf(pitch.step) + steps
  return { ...pitch, step: LETTERS[((abs % 7) + 7) % 7], octave: Math.floor(abs / 7) }
}

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
