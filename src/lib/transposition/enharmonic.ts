import type { Pitch, KeySig } from '../../types/score'
import { midiToPitch } from '../vexflow/renderer'

// Sharp keys prefer sharps; flat keys prefer flats.
// Returns the preferred enharmonic spelling for a given MIDI note in a given key.
export function chooseSpelling(midi: number, keySig: KeySig): Pitch {
  const preferFlats = keySig.fifths < 0
  const pitch = midiToPitch(midi)

  // If the default spelling already matches preference, use it
  if (preferFlats && pitch.accidental === 'sharp') {
    // Enharmonic equivalents: C#=Db, D#=Eb, F#=Gb, G#=Ab, A#=Bb
    const enharmonics: Record<string, Pitch> = {
      'C#': { step: 'D', octave: pitch.octave, accidental: 'flat' },
      'D#': { step: 'E', octave: pitch.octave, accidental: 'flat' },
      'F#': { step: 'G', octave: pitch.octave, accidental: 'flat' },
      'G#': { step: 'A', octave: pitch.octave, accidental: 'flat' },
      'A#': { step: 'B', octave: pitch.octave, accidental: 'flat' },
    }
    const key = `${pitch.step}#`
    return enharmonics[key] ?? pitch
  }

  return pitch
}
