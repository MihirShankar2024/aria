import type { InstrumentConfig } from '../types/audio'

export const INSTRUMENT_DB: Record<string, InstrumentConfig> = {
  trumpet_bb: {
    key: 'trumpet_bb',
    displayName: 'Trumpet in Bb',
    transposition: 2,          // sounds a major 2nd lower than written
    clef: 'treble',
    rangeMin: 52,              // E3 concert (written F#3)
    rangeMax: 84,              // C6 concert (written D6)
    comfortableMin: 55,        // G3 concert
    comfortableMax: 79,        // G5 concert
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/trumpet-mp3.js',
  },
  piano: {
    key: 'piano',
    displayName: 'Piano',
    transposition: 0,
    clef: 'treble',
    rangeMin: 21,              // A0
    rangeMax: 108,             // C8
    comfortableMin: 21,
    comfortableMax: 108,
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js',
  },
  violin: {
    key: 'violin',
    displayName: 'Violin',
    transposition: 0,
    clef: 'treble',
    rangeMin: 55,              // G3
    rangeMax: 103,             // G7
    comfortableMin: 55,
    comfortableMax: 96,
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/violin-mp3.js',
  },
  alto_saxophone: {
    key: 'alto_saxophone',
    displayName: 'Alto Saxophone (Eb)',
    transposition: 9,          // written a major 6th above concert (Eb instrument)
    clef: 'treble',
    rangeMin: 49,              // Db3 concert (written Bb3)
    rangeMax: 80,              // Ab5 concert (written F6)
    comfortableMin: 52,
    comfortableMax: 77,
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/alto_sax-mp3.js',
  },
  french_horn: {
    key: 'french_horn',
    displayName: 'Horn in F',
    transposition: 7,          // written a perfect 5th above concert
    clef: 'treble',
    rangeMin: 34,              // Bb1 concert
    rangeMax: 77,              // F5 concert
    comfortableMin: 41,
    comfortableMax: 72,
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/french_horn-mp3.js',
  },
  piano_bass: {
    key: 'piano_bass',
    displayName: 'Piano (Bass)',
    transposition: 0,
    clef: 'bass',
    rangeMin: 21,              // A0
    rangeMax: 71,              // B4 (low register)
    comfortableMin: 21,
    comfortableMax: 71,
    soundfontUrl: 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js',
  },
}

export function getInstrument(key: string): InstrumentConfig {
  return INSTRUMENT_DB[key] ?? INSTRUMENT_DB['piano']
}

export function isInRange(midiNote: number, instrument: InstrumentConfig): 'in' | 'uncomfortable' | 'out' {
  if (midiNote < instrument.rangeMin || midiNote > instrument.rangeMax) return 'out'
  if (midiNote < instrument.comfortableMin || midiNote > instrument.comfortableMax) return 'uncomfortable'
  return 'in'
}
