export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Accidental = 'sharp' | 'flat' | 'natural' | 'double_sharp' | 'double_flat' | null
export type Duration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
export type Clef = 'treble' | 'bass' | 'alto'

/** Manual placement of a notehead's accidental or dot glyph. Set when the user drags the
 *  glyph's handle. `dx` is the glyph-center X relative to the notehead anchor, so the glyph
 *  is pinned to its notehead and stays put when other tones/accidentals are added to the
 *  chord (independent of VexFlow's auto column layout). `dy` is a vertical offset from the
 *  auto line. Once set, the glyph is fully user-controlled. */
export interface GlyphOffset {
  dx: number
  dy: number
}

export interface Pitch {
  id: string         // stable per-notehead id; survives chord re-sort and transpose
  step: NoteName
  octave: number
  accidental: Accidental
  accidentalOffset?: GlyphOffset   // manual nudge of this pitch's accidental glyph
  dotOffset?: GlyphOffset          // manual nudge of this pitch's dot(s)
}

export interface Note {
  id: string
  type: 'note'
  pitches: Pitch[]   // min 1 element; sorted low-to-high by octave for rendering
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

/**
 * A tie/slur span connecting two notes. Visually one curve covering every note
 * between `from` and `to` (rests break a drag into separate spans, so a span
 * never crosses a rest). Tie vs. slur is derived later by the engine: a *tie*
 * when all spanned notes share a pitch (sustained), otherwise a *slur* (legato).
 * Stored at the Part level since spans may cross barlines; note ids are global.
 */
/**
 * Manual override of a slur/tie's drawn curve, applied on top of the auto-computed
 * shape. Set once the user drags a placed slur's handles; absent means fully automatic.
 */
export interface TieCurveOverride {
  direction?: 1 | -1   // 1 = bulge down, -1 = bulge up
  cp1?: number         // control-point depth (arch height)
  cp2?: number
  startDX?: number     // pixel shift of the start endpoint
  startDY?: number
  endDX?: number       // pixel shift of the end endpoint
  endDY?: number
}

/** One endpoint of a tie/slur: a specific notehead, identified by its event id and the
 *  stable `Pitch.id` within that event. Resolving by pitch id (not array index) lets the
 *  curve follow the notehead across chord re-sorts and transposes. */
export interface TieEnd {
  note: string   // event (note) id
  pitch: string  // Pitch.id of the connected notehead
}

export interface Tie {
  id: string
  from: TieEnd   // notehead earlier in document order
  to: TieEnd     // notehead later in document order
  curve?: TieCurveOverride  // manual drag adjustments, if any
}

export interface Part {
  id: string
  name: string
  instrument: string    // key into INSTRUMENT_DB
  clef: Clef
  measures: Measure[]
  ties?: Tie[]
  grandStaffPartnerId?: string  // ID of the linked part (piano: treble ↔ bass)
}

export interface Score {
  id: string
  title: string
  tempo: number
  globalTimeSig: TimeSig
  globalKeySig: KeySig
  parts: Part[]
  tempoChanges: { measureNumber: number; tempo: number }[]  // sorted ascending by measureNumber
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
