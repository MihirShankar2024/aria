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
      'C#': { ...pitch, step: 'D', accidental: 'flat' },
      'D#': { ...pitch, step: 'E', accidental: 'flat' },
      'F#': { ...pitch, step: 'G', accidental: 'flat' },
      'G#': { ...pitch, step: 'A', accidental: 'flat' },
      'A#': { ...pitch, step: 'B', accidental: 'flat' },
    }
    const key = `${pitch.step}#`
    return enharmonics[key] ?? pitch
  }

  return pitch
}
