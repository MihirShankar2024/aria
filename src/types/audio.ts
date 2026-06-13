export type PlaybackStatus = 'stopped' | 'playing' | 'paused'

export interface PlaybackState {
  status: PlaybackStatus
  currentBeat: number
  loopStart: number | null
  loopEnd: number | null
  tempo: number
}

export type SoundFontStatus = 'unloaded' | 'loading' | 'ready' | 'error'

export interface InstrumentConfig {
  key: string
  displayName: string
  transposition: number     // semitones up from concert pitch (e.g. Bb trumpet = 2)
  clef: 'treble' | 'bass' | 'alto'
  rangeMin: number          // MIDI note number
  rangeMax: number          // MIDI note number
  comfortableMin: number    // idiomatic low
  comfortableMax: number    // idiomatic high
  soundfontUrl: string      // URL template for samples
}

export interface PitchEvent {
  midiNote: number
  startTime: number         // seconds
  endTime: number           // seconds
  amplitude: number         // 0–1 confidence / velocity
}
