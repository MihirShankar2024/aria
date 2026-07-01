export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Accidental = 'sharp' | 'flat' | 'natural' | 'double_sharp' | 'double_flat' | null
export type Duration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
export type Clef = 'treble' | 'bass' | 'alto'

/** Which independent voice an event belongs to within a staff. Voice 1 stems up,
 *  voice 2 stems down. Two voices may occupy the same beat with different rhythms. */
export type VoiceNumber = 1 | 2

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

/** Articulation marks. Attach to a whole event (a chord / all notes of one voice at a beat),
 *  not a single pitch. Multiple may stack on one event (e.g. staccato + accent). */
export type ArticulationType =
  | 'staccato' | 'tenuto' | 'fermata' | 'accent' | 'marcato'
  | 'spiccato' | 'upBow' | 'downBow' | 'lhPizz' | 'snapPizz' | 'open'

/** One articulation mark on an event. `offset` is a manual Sharpshooter nudge (like
 *  `accidentalOffset`); once set the glyph is fully user-controlled. */
export interface NoteArticulation {
  type: ArticulationType
  offset?: GlyphOffset
}

export interface Note {
  id: string
  type: 'note'
  pitches: Pitch[]   // min 1 element; sorted low-to-high by octave for rendering
  duration: Duration
  dots: number
  tied: boolean
  voice: VoiceNumber
  articulations?: NoteArticulation[]   // event-level marks; set has at most one entry per type
}

export interface Rest {
  id: string
  type: 'rest'
  duration: Duration
  dots: number
  voice: VoiceNumber
  articulations?: NoteArticulation[]   // event-level marks (e.g. fermata over a rest)
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

/**
 * A tuplet groups consecutive events of ONE voice within a measure, printing `played`
 * notes in the time normally occupied by `inSpaceOf` of the same written value (an
 * eighth-note triplet is played:3 / inSpaceOf:2). Members keep their written
 * `Duration`/`dots`; the tuplet supplies a time scale (`inSpaceOf / played`) applied only
 * in beat math and handed to VexFlow for rendering. Stored on the measure (voice is
 * implied by the members' `.voice`) and keyed by member event id so the group survives
 * re-ordering and nesting. `parentId` points at the enclosing tuplet for nested tuplets.
 */
export interface Tuplet {
  id: string
  played: number          // notes printed (the "3" in a triplet)
  inSpaceOf: number        // in the time of this many (the "2" in 3:2)
  memberIds: string[]      // NoteEvent ids, in document order, all the same voice
  placeholderIds?: string[] // subset of memberIds: reserved-but-unfilled slots (empty when full).
                            // A committed rest is NOT listed, so it survives instead of being backfilled.
  parentId?: string        // enclosing tuplet, for nesting
  showBracket?: boolean    // engraving hint; undefined = VexFlow auto
  showNumber?: boolean     // engraving hint; undefined = VexFlow auto
}

export interface Measure {
  id: string
  number: number
  notes: NoteEvent[]
  tuplets?: Tuplet[]    // tuplet groups in this measure (voice implied by members)
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

/**
 * A free-floating expressive mark (dynamic, ornament, engraving symbol, or text) placed by
 * the user with the Annotations tool. Pinned to a measure by `measureId` + pixel offset so it
 * travels with that measure when the score reflows. Stored at the Part level like `ties`.
 */
export interface AnnotationAnchor {
  measureId: string   // measure the mark is pinned to (resolved to current x via layout)
  dx: number          // px from the measure's left edge (layout.measures[i].x)
  dy: number          // px from the staff top (staveY) — vertical position
  // AI/auto placement: when `auto` is true the (dx, dy) are IGNORED and the position is computed at
  // render time by the placement engine (src/lib/annotations/placement.ts) from the mark's type +
  // note geometry. `eventId`/`pitchId` optionally target a specific note/head (for per-beat dynamics,
  // ornaments over a note, tremolo on a stem, gliss endpoints). Dragging the mark clears `auto` and
  // bakes concrete dx/dy — a manual override that then behaves like any hand-placed mark (like ties).
  auto?: boolean
  eventId?: string    // note/rest this mark attaches to (its x + note extent drive placement)
  pitchId?: string    // specific notehead within a chord (e.g. a gliss start head)
}

/** A glyph mark drawn with one or more Bravura/SMuFL codepoints (dynamics, ornaments, single symbols). */
export interface GlyphAnnotation {
  id: string
  kind: 'glyph'
  glyph: string            // SMuFL codepoint string (may be composed of several, e.g. "sfz")
  symbolId: string         // catalog key, e.g. 'dyn.sfz', 'orn.trill', 'sym.coda'
  anchor: AnnotationAnchor
  scale?: number           // base size multiplier (default 1)
  scaleX?: number          // sharpshooter horizontal stretch (default 1)
  scaleY?: number          // sharpshooter vertical stretch (default 1; arpeggio height, repeat-sign size)
}

export type LineAnnotationType =
  | 'gliss' | 'trillExt' | 'cresc' | 'decresc' | 'ottava8va'
  | 'ottava8vb' | 'ending1' | 'ending2' | 'pedalBracket'

/** A stretchable line/bracket mark with two free endpoints (hairpins, 8va, endings, pedal, gliss). */
export interface LineAnnotation {
  id: string
  kind: 'line'
  lineType: LineAnnotationType
  anchor: AnnotationAnchor  // start endpoint (measure-anchored)
  endDX: number             // end endpoint, px from the SAME measure's left edge
  endDY: number             // end endpoint, px from the staff top
  // For auto-placed two-endpoint marks (gliss, trill extension): the note/head the END attaches to.
  // When set alongside anchor.auto, both endpoints are resolved from note geometry at render time.
  endEventId?: string
  endPitchId?: string
}

export interface TextAnnotationStyle {
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
}

/** A free editable text mark. */
export interface TextAnnotation {
  id: string
  kind: 'text'
  text: string
  anchor: AnnotationAnchor
  style: TextAnnotationStyle
  symbolId?: string   // catalog key (e.g. 'text.tempo', 'sym.ds') — drives auto-placement routing
}

/** A measure-number box. Carries no number of its own — it renders the `number` of whichever
 *  measure it is anchored to (re-anchored to the measure under it when dragged). */
export interface MeasureNumberAnnotation {
  id: string
  kind: 'measureNumber'
  anchor: AnnotationAnchor
}

export type Annotation = GlyphAnnotation | LineAnnotation | TextAnnotation | MeasureNumberAnnotation

export interface Part {
  id: string
  name: string
  instrument: string    // key into INSTRUMENT_DB
  clef: Clef
  measures: Measure[]
  ties?: Tie[]
  annotations?: Annotation[]    // free-floating expressive marks placed with the Annotations tool
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
