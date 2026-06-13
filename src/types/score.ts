export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Accidental = 'sharp' | 'flat' | 'natural' | 'double_sharp' | 'double_flat' | null
export type Duration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
export type Clef = 'treble' | 'bass' | 'alto'

export interface Pitch {
  step: NoteName
  octave: number
  accidental: Accidental
}

export interface Note {
  id: string
  type: 'note'
  pitch: Pitch
  duration: Duration
  dots: number
  tied: boolean
}

export interface Rest {
  id: string
  type: 'rest'
  duration: Duration
  dots: number
}

export type NoteEvent = Note | Rest

export interface TimeSig {
  beats: number
  beatType: number
}

export interface KeySig {
  fifths: number        // -7 (7 flats) to +7 (7 sharps)
  mode: 'major' | 'minor'
}

export interface Measure {
  id: string
  number: number
  notes: NoteEvent[]
  timeSig?: TimeSig     // only set when it changes from global
  keySig?: KeySig       // only set when it changes from global
}

export interface Part {
  id: string
  name: string
  instrument: string    // key into INSTRUMENT_DB
  clef: Clef
  measures: Measure[]
}

export interface Score {
  id: string
  title: string
  tempo: number
  globalTimeSig: TimeSig
  globalKeySig: KeySig
  parts: Part[]
}

export interface Branch {
  id: string
  name: string
  score: Score
  createdAt: string     // ISO string
}

export interface ScoreDocument {
  id: string
  userId: string
  title: string
  activeBranchId: string
  branches: Branch[]
  updatedAt: string
}
