import type { Note, NoteName, Pitch, Measure, KeySig } from '../../types/score'
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
  // Preserve the source notehead id so ties/slurs attached to it follow the transpose.
  return { ...midiToPitch(pitchToMidi(pitch) + semitones), id: pitch.id }
}

const OFFSET_TO_ACC: Record<number, Pitch['accidental']> = {
  2: 'double_sharp', 1: 'sharp', 0: 'natural', '-1': 'flat', '-2': 'double_flat',
}

// Transpose by a musical *interval* (so spelling stays diatonic), as opposed to the
// chromatic re-spell above. Shifts the letter by the interval's diatonic-step count
// and re-derives the accidental. Used by concert/written conversion, where the key
// signature is transposed alongside (see transposeKeyFifths), so:
//  - a key-implied note (accidental null) keeps null and rides the transposed key sig;
//  - an explicitly-altered note keeps its exact sounding pitch (concert +/- interval).
function transposeInterval(pitch: Pitch, semitones: number): Pitch {
  if (semitones === 0) return pitch
  // Each semitone ~ 7 fifths ~ 4/7 of a letter; round to the interval's letter span.
  const letterSteps = Math.round((semitones * 7) / 12)
  const shifted = diatonicStep(pitch, letterSteps)
  if (pitch.accidental === null) {
    return { ...shifted, accidental: null, id: pitch.id }
  }
  const offset = (pitchToMidi(pitch) + semitones) - pitchToMidi({ ...shifted, accidental: null })
  return { ...shifted, accidental: OFFSET_TO_ACC[offset] ?? 'natural', id: pitch.id }
}

// Transpose a key signature (in fifths) by `semitones`. Each semitone moves 7 steps
// around the circle of fifths; we pick the minimal-accidental spelling and wrap any
// overflow into the displayable [-7, 7] range enharmonically.
export function transposeKeyFifths(fifths: number, semitones: number): number {
  let shift = ((semitones * 7) % 12 + 12) % 12   // 0..11
  if (shift > 6) shift -= 12                       // -> [-5, 6]
  let result = fifths + shift
  while (result > 7) result -= 12
  while (result < -7) result += 12
  return result
}

// Pitch-level conversions. A click in transposed view yields a written pitch that must
// be stored as concert (writtenPitchToConcert); the reverse spells a stored concert
// pitch for hit-testing against the written display. No-ops for non-transposing parts.
export function writtenPitchToConcert(pitch: Pitch, instrumentKey: string): Pitch {
  return transposeInterval(pitch, -getInstrument(instrumentKey).transposition)
}

export function concertPitchToWritten(pitch: Pitch, instrumentKey: string): Pitch {
  return transposeInterval(pitch, getInstrument(instrumentKey).transposition)
}

// Convert a concert-pitch note to the written pitch for a transposing instrument.
// e.g. concert C4 → written D4 for Bb trumpet (transposition = +2)
export function concertToWritten(note: Note, instrumentKey: string): Note {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return note
  return { ...note, pitches: note.pitches.map(p => transposeInterval(p, instrument.transposition)) }
}

// Convert a written pitch for a transposing instrument back to concert pitch.
export function writtenToConcert(note: Note, instrumentKey: string): Note {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return note
  return { ...note, pitches: note.pitches.map(p => transposeInterval(p, -instrument.transposition)) }
}

// Display helpers: turn a part's concert-pitch measures/key into the written
// (transposed) form for rendering. No-op for non-transposing instruments. All ids
// are preserved so ties/slurs/selection keep matching.
export function transposeKeySigForDisplay(keySig: KeySig, instrumentKey: string): KeySig {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return keySig
  return { ...keySig, fifths: transposeKeyFifths(keySig.fifths, instrument.transposition) }
}

export function transposeMeasuresForDisplay(measures: Measure[], instrumentKey: string): Measure[] {
  const instrument = getInstrument(instrumentKey)
  if (instrument.transposition === 0) return measures
  return measures.map(m => ({
    ...m,
    keySig: m.keySig ? transposeKeySigForDisplay(m.keySig, instrumentKey) : m.keySig,
    notes: m.notes.map(e => (e.type === 'note' ? concertToWritten(e, instrumentKey) : e)),
  }))
}
