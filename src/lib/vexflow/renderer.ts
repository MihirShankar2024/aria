import {
  Renderer,
  Stave,
  StaveNote,
  GhostNote,
  Voice,
  Formatter,
  Accidental as VexAccidental,
  Dot,
  Modifier,
  Beam,
  StaveTie,
  StaveConnector,
  MetricsDefaults,
} from 'vexflow'
import type { Measure, Note, Pitch, TimeSig, KeySig, Tie, Clef, NoteEvent, Part, GlyphOffset } from '../../types/score'
import { measureCapacity, measureBeatCount } from '../beats'
import { newPitchId } from '../pitch'

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

// VexFlow's default accidental spacing is extremely tight (1px notehead gap, 3px between
// columns), so dense chord clusters where every tone carries an accidental collide and
// "bleed" into each other and the noteheads. Loosen it for legible, well-separated
// columns — VexFlow already arranges accidentals into Gould-style zig-zag columns; this
// just gives those columns room to breathe. Applied once at module load.
// H8 runtime logs confirm intra-chord accidental/head collisions in dense sharp
// stacks. Increase default accidental column separation and head clearance.
MetricsDefaults.Accidental.noteheadAccidentalPadding = 12
// Keep inter-accidental spacing close to default; the issue is head clearance.
MetricsDefaults.Accidental.accidentalSpacing = 7
MetricsDefaults.Accidental.leftPadding = 6

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.octave === b.octave && a.accidental === b.accidental
}

// Furthest Y of a note toward a slur's bulge, counting the stem/beam — not just
// the notehead. direction === 1 → slur bulges downward (larger y); -1 → upward
// (smaller y). This lets the slur clear stems that point into its path instead
// of only clearing noteheads.
function extremeYTowardSlur(vn: StaveNote, direction: number): number {
  const ys = [...vn.getYs()]
  try {
    const ext = vn.getStemExtents()
    if (ext) ys.push(ext.topY, ext.baseY)
  } catch {
    // No stem (e.g. whole note) — noteheads are the only extent.
  }
  try {
    // Include the full glyph bounds so accidentals (and dots) poking toward the slur
    // are cleared, not just noteheads and stems.
    const bb = vn.getBoundingBox()
    if (bb) ys.push(bb.getY(), bb.getY() + bb.getH())
  } catch { /* bounding box unavailable — extents above suffice */ }
  return direction === 1 ? Math.max(...ys) : Math.min(...ys)
}

// A slur between two different pitches anchored exactly at each notehead reads too
// steep. Ease both endpoints toward their shared midline so the lower end starts a
// little higher and the higher end a little lower — a gentler arc. Real ties (same
// pitch, near-flat already) are left untouched.
const SLUR_ENDPOINT_FLATTEN = 0.25
function flattenedEndpointYs(
  first: StaveNote,
  last: StaveNote,
  isTie: boolean,
  fromIdx: number,
  toIdx: number,
): { firstYs: number[]; lastYs: number[] } {
  const firstYs = first.getYs()
  const lastYs = last.getYs()
  if (isTie) return { firstYs, lastYs }
  const fY = firstYs[fromIdx]
  const lY = lastYs[toIdx]
  if (fY === undefined || lY === undefined || fY === lY) return { firstYs, lastYs }
  const mid = (fY + lY) / 2
  const newFirst = [...firstYs]
  const newLast = [...lastYs]
  newFirst[fromIdx] = fY + (mid - fY) * SLUR_ENDPOINT_FLATTEN
  newLast[toIdx] = lY + (mid - lY) * SLUR_ENDPOINT_FLATTEN
  return { firstYs: newFirst, lastYs: newLast }
}

// Layout constants
const LEFT_MARGIN = 10
const RIGHT_MARGIN = 10
const NOTE_PAD = 24
const FIRST_MEASURE_ALLOWANCE = 130  // clef + key sig (up to 7 acc) + time sig
const KEY_CHANGE_ALLOWANCE = 80      // naturals + new accidentals on key change
const TIME_CHANGE_ALLOWANCE = 40     // time sig glyph on mid-score changes
const MIN_NOTE_AREA = 120
const MAX_NOTE_AREA = 400
const SNAP_STEP = 32
const SPACING_FACTOR = 1.5
const BLEND_FACTOR = 0.35
export const STAFF_HEIGHT = 192

// Key signature: fifths → VexFlow key name
const FIFTHS_TO_KEY = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
function fifthsToVexKey(fifths: number): string {
  return FIFTHS_TO_KEY[(fifths + 7) % 15] ?? 'C'
}

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

// Visual center x of a note/rest glyph. getAbsoluteX() is the left anchor, which
// for rests sits to the left of the glyph; the bounding box gives the true center.
function glyphCenterX(vn: StaveNote): number {
  try {
    const bb = vn.getBoundingBox()
    if (bb) return bb.getX() + bb.getW() / 2
  } catch { /* fall back to anchor below */ }
  return vn.getAbsoluteX()
}

// Center of a note's primary notehead, deliberately excluding accidentals/dots so the
// cursor and arrow-key snapping target the head itself (notePx is the bare notehead
// width; getAbsoluteX is its left edge). Rests use glyphCenterX instead.
function noteheadCenterX(vn: StaveNote): number {
  try {
    const m = vn.getMetrics()
    return vn.getAbsoluteX() + (m.notePx ?? 0) / 2
  } catch {
    return vn.getAbsoluteX()
  }
}

// Per-notehead anchor x for every pitch of a chord, aligned 1:1 with getYs().
// Seconds are displaced by ~a notehead width, which getAbsoluteX() reflects — so this
// captures the real side-by-side positions. Rests (no heads) fall back to the anchor.
function noteHeadXs(vn: StaveNote, ax: number): number[] {
  try {
    const heads = vn.noteHeads
    if (heads.length) return heads.map(h => h.getAbsoluteX())
  } catch { /* fall back to anchor below */ }
  return [ax]
}

// Min clear gap (px) we guarantee between a note's right edge and the next note's
// left-side accidentals — VexFlow's own minimum is too tight for dense clusters.
const ACC_GAP = 8

// Horizontal extents of a note's full glyph — left-side accidentals/displaced heads,
// and right-side dots/displaced heads — relative to its notehead anchor (getAbsoluteX).
// Valid only after the owning voice has been formatted. Mirrors VexFlow's own
// xStart/xEnd computation in Note (modLeftPx + leftDisplacedHeadPx on the left, etc.).
function noteExtents(vn: StaveNote): { accLeft: number; rightExt: number } {
  try {
    const m = vn.getMetrics()
    return {
      accLeft: (m.modLeftPx ?? 0) + (m.leftDisplacedHeadPx ?? 0),
      rightExt: (m.notePx ?? 0) + (m.rightDisplacedHeadPx ?? 0) + (m.modRightPx ?? 0),
    }
  } catch {
    return { accLeft: 0, rightExt: 0 }
  }
}

// Note-area width that guarantees no adjacent pair's glyphs (incl. accidentals and
// displaced noteheads) overlap, enforcing ACC_GAP between them plus a leading/trailing
// allowance for the outer notes' own glyphs. Falls back to VexFlow's vexMin when richer.
function accidentalAwareMinWidth(realNotes: StaveNote[], voice: Voice, vexMin: number): number {
  if (realNotes.length === 0) return vexMin
  try {
    // getMetrics() requires a pre-formatted voice; format at the bare minimum first.
    new Formatter().joinVoices([voice]).format([voice], vexMin)
  } catch {
    return vexMin
  }
  const ext = realNotes.map(noteExtents)
  let floor = ext[0].accLeft
  for (let i = 0; i < realNotes.length - 1; i++) {
    floor += ext[i].rightExt + ACC_GAP + ext[i + 1].accLeft
  }
  floor += ext[ext.length - 1].rightExt
  return Math.max(vexMin, Math.ceil(floor))
}

// Per-measure note-area sizing from a built voice: the hard minimum (accidental-aware,
// the collision floor) and the blended-down "raw" preferred width. The MAX_NOTE_AREA cap
// is lifted to the floor when accidental clearance demands more than 400px.
function rawWidthFromVoice(realNotes: StaveNote[], voice: Voice): { min: number; raw: number } {
  const vexMin = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice])
  const min = accidentalAwareMinWidth(realNotes, voice, vexMin)
  const cap = Math.max(MAX_NOTE_AREA, Math.ceil(min))
  const preferred = snapUp(Math.min(Math.max(Math.ceil(min * SPACING_FACTOR), MIN_NOTE_AREA), cap), SNAP_STEP)
  return { min, raw: Math.max(preferred, Math.ceil(min)) }
}

// Faint guide lines two positions above and below the staff, so high/low notes
// are easy to aim at. Drawn directly on the VexFlow SVG context after the stave.
function drawLedgerGuides(ctx: ReturnType<InstanceType<typeof Renderer>['getContext']>, stave: Stave): void {
  const x1 = stave.getNoteStartX()
  const x2 = stave.getX() + stave.getWidth()
  const lines = [-1, -2, 5, 6]
  ctx.save()
  ctx.setLineWidth(1)
  ctx.setStrokeStyle('rgba(0,0,0,0.22)')
  for (const ln of lines) {
    const y = stave.getYForLine(ln)
    ctx.beginPath()
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()
  }
  ctx.restore()
}

// Per-measure raw note-area widths (and the VexFlow minimums) for one staff —
// the busiest-content sizing used for both single-staff and system-wide layout.
function computeColumnWidths(measures: Measure[], effTimeSigs: TimeSig[], clef: Clef = 'treble'): { raws: number[]; mins: number[] } {
  const mins: number[] = []
  const raws = measures.map((m, i) => {
    const { realNotes, voice } = buildMeasure(m, effTimeSigs[i] ?? effTimeSigs[effTimeSigs.length - 1], clef)
    if (!voice) { mins.push(0); return MIN_NOTE_AREA }
    const { min, raw } = rawWidthFromVoice(realNotes, voice)
    mins.push(min)
    return raw
  })
  return { raws, mins }
}

function decorForMeasure(effKs: KeySig[], effTs: TimeSig[], i: number, isGrand: boolean): number {
  if (i === 0) return FIRST_MEASURE_ALLOWANCE + (isGrand ? 20 : 0)
  const prevKey = effKs[i - 1], curKey = effKs[i]
  const prevTs = effTs[i - 1], curTs = effTs[i]
  if (!prevKey || !curKey || !prevTs || !curTs) return 0
  const keyChanged = prevKey.fifths !== curKey.fifths
  const tsChanged  = prevTs.beats !== curTs.beats || prevTs.beatType !== curTs.beatType
  return (keyChanged ? KEY_CHANGE_ALLOWANCE : 0) + (tsChanged ? TIME_CHANGE_ALLOWANCE : 0)
}

/**
 * Compute one shared stave-width per measure index across ALL parts so barlines
 * line up vertically across every staff (standard system engraving). Each column
 * is still sized to its busiest content — only now "busiest" is taken across all
 * parts — preserving our content-based, blended sizing principle.
 */
export function computeSystemStaveWidths(parts: Part[], globalTimeSig: TimeSig, globalKeySig: KeySig): number[] {
  const count = parts.reduce((mx, p) => Math.max(mx, p.measures.length), 0)
  if (count === 0) return []

  const perPart = parts.map(part => {
    const effTs = part.measures.map((_, i) => effectiveTimeSigAt(part.measures, i, globalTimeSig))
    const effKs = part.measures.map((_, i) => effectiveKeySigAt(part.measures, i, globalKeySig))
    const { raws, mins } = computeColumnWidths(part.measures, effTs, part.clef)
    return { isGrand: !!part.grandStaffPartnerId, effTs, effKs, raws, mins }
  })

  const syncRaw: number[] = []
  const syncMin: number[] = []
  for (let i = 0; i < count; i++) {
    let r = MIN_NOTE_AREA, m = 0
    for (const pp of perPart) {
      r = Math.max(r, pp.raws[i] ?? MIN_NOTE_AREA)
      m = Math.max(m, pp.mins[i] ?? 0)
    }
    syncRaw.push(r); syncMin.push(m)
  }
  const maxWidth = Math.max(...syncRaw)
  const noteAreaWidths = syncRaw.map((w, i) =>
    Math.max(Math.round(w + BLEND_FACTOR * (maxWidth - w)), Math.ceil(syncMin[i])),
  )

  return noteAreaWidths.map((w, i) => {
    let decor = 0
    for (const pp of perPart) decor = Math.max(decor, decorForMeasure(pp.effKs, pp.effTs, i, pp.isGrand))
    return w + NOTE_PAD + decor
  })
}

export function midiToPitch(midi: number): Pitch {
  const octave = Math.floor(midi / 12) - 1
  const semitone = midi % 12
  const chromatic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
  const accidentals: Array<'sharp' | null> = [null, 'sharp', null, 'sharp', null, null, 'sharp', null, 'sharp', null, 'sharp', null]
  const step = NOTE_NAMES[chromatic[semitone]] as Pitch['step']
  return { id: newPitchId(), step, octave, accidental: accidentals[semitone] }
}

function pitchToVexKey(pitch: Pitch): string {
  const acc = pitch.accidental === 'sharp' ? '#' : pitch.accidental === 'flat' ? 'b' : ''
  return `${pitch.step}${acc}/${pitch.octave}`
}

function durationToVex(dur: NoteEvent['duration'], dots: number): string {
  const map: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', sixteenth: '16' }
  return map[dur] + (dots > 0 ? 'd' : '')
}

function accidentalToVex(acc: Pitch['accidental']): string | null {
  const map: Record<string, string> = { sharp: '#', flat: 'b', natural: 'n', double_sharp: '##', double_flat: 'bb' }
  return acc ? (map[acc] ?? null) : null
}

const GHOST_SLOTS: Array<{ dur: string; beats: number }> = [
  { dur: 'w', beats: 4 },
  { dur: 'h', beats: 2 },
  { dur: 'q', beats: 1 },
  { dur: '8', beats: 0.5 },
  { dur: '16', beats: 0.25 },
]

function buildGhostNotes(remainingBeats: number): GhostNote[] {
  const ghosts: GhostNote[] = []
  let left = remainingBeats
  for (const { dur, beats } of GHOST_SLOTS) {
    while (left >= beats - 0.001) {
      ghosts.push(new GhostNote({ duration: dur }))
      left -= beats
    }
  }
  return ghosts
}

function buildVexNote(event: NoteEvent, clef: Clef = 'treble'): StaveNote {
  if (event.type === 'rest') {
    // Center the rest on the clef's middle line: treble→b/4, bass→d/3, alto→c/4.
    // Using a single key for all clefs would float bass/alto rests off the staff.
    const restKey = clef === 'bass' ? 'd/3' : clef === 'alto' ? 'c/4' : 'b/4'
    const vn = new StaveNote({ keys: [restKey], duration: durationToVex(event.duration, event.dots) + 'r', clef })
    if (event.dots > 0) Dot.buildAndAttach([vn], { all: true })
    return vn
  }
  const note = event as Note
  // Sort pitches low-to-high; VexFlow expects ascending order for chords.
  const keys = note.pitches.map(pitchToVexKey)
  const vn = new StaveNote({
    keys,
    duration: durationToVex(note.duration, note.dots),
    clef,
  })
  // Attach accidentals per key index, then dots.
  note.pitches.forEach((pitch, idx) => {
    const vexAcc = accidentalToVex(pitch.accidental)
    if (vexAcc) vn.addModifier(new VexAccidental(vexAcc), idx)
  })
  if (note.dots > 0) Dot.buildAndAttach([vn], { all: true })
  return vn
}

// Pin a manually-moved glyph to its notehead. offset.dx is the desired glyph-center X
// relative to the notehead anchor (getAbsoluteX), so the position is independent of
// VexFlow's accidental/dot column layout — adding notes/accidentals to the chord won't
// drag an already-moved glyph. offset.dy is a vertical offset from the auto line (which
// is itself stable, since a notehead's Y doesn't move when chord tones are added).
function pinGlyph(vn: StaveNote, mod: VexAccidental | Dot, noteheadX: number, idx: number, offset: GlyphOffset): void {
  const pos = mod.getPosition()
  const isLeft = pos === Modifier.Position.LEFT
  const width = mod.getWidth()
  const start = vn.getModifierStartXY(pos, idx)
  // Center X when our shift is zero: accidentals (LEFT) draw left of start, dots (RIGHT) right.
  const baseCenterX = isLeft ? start.x - width / 2 : start.x + width / 2
  const shift = (noteheadX + offset.dx) - baseCenterX
  // Modifier.setXShift negates for LEFT-positioned glyphs; getModifierStartXY hard-anchors
  // to getAbsoluteX, so this fully replaces the formatter's column shift.
  mod.setXShift(isLeft ? -shift : shift)
  mod.setYShift(mod.getYShift() + offset.dy)
}

// Apply stored per-pitch glyph offsets to a note's accidental/dot modifiers. Call after
// Formatter.format() and before voice.draw() so the pin rides on top of auto placement.
function applyGlyphOffsets(vn: StaveNote, note: Note): void {
  const noteheadX = vn.getAbsoluteX()
  for (const mod of vn.getModifiers()) {
    const idx = mod.getIndex()
    if (idx === undefined) continue
    const pitch = note.pitches[idx]
    if (!pitch) continue
    if (mod instanceof VexAccidental) {
      if (pitch.accidentalOffset) pinGlyph(vn, mod, noteheadX, idx, pitch.accidentalOffset)
    } else if (mod instanceof Dot) {
      if (pitch.dotOffset) pinGlyph(vn, mod, noteheadX, idx, pitch.dotOffset)
    }
  }
}

// Read the drawn center of each accidental/dot glyph for drag-handle placement. Call after
// voice.draw() so bounding boxes reflect the rendered (and nudged) positions.
function collectGlyphGeometry(vn: StaveNote, note: Note, out: GlyphGeometry[]): void {
  for (const mod of vn.getModifiers()) {
    const idx = mod.getIndex()
    if (idx === undefined || note.pitches[idx] === undefined) continue
    const kind = mod instanceof VexAccidental ? 'accidental' : mod instanceof Dot ? 'dot' : null
    if (!kind) continue
    const bb = mod.getBoundingBox()
    out.push({ noteId: note.id, pitchIndex: idx, kind, x: bb.getX() + bb.getW() / 2, y: bb.getY() + bb.getH() / 2, w: bb.getW(), h: bb.getH() })
  }
}

// Detect accidental glyphs that intrude into any notehead zone of the same chord.
// This catches dense stacked-seconds cases where VexFlow's column packing can still
// visually crowd or overlap displaced heads.
function collectIntraChordAccidentalConflicts(
  vn: StaveNote,
  note: Note,
  measureIndex: number,
  out: Array<{ noteId: string; measureIndex: number; pitchIndex: number; headIndex: number; overlapPx: number }>,
): void {
  const headXs = noteHeadXs(vn, vn.getAbsoluteX())
  const headYs = vn.getYs()
  for (const mod of vn.getModifiers()) {
    if (!(mod instanceof VexAccidental)) continue
    const pIdx = mod.getIndex()
    if (pIdx === undefined || note.pitches[pIdx] === undefined) continue
    const bb = mod.getBoundingBox()
    const accRight = bb.getX() + bb.getW()
    for (let i = 0; i < headXs.length; i++) {
      const hx = headXs[i]
      const hy = headYs[i]
      // Only compare against heads on nearby staff rows.
      if (Math.abs((bb.getY() + bb.getH() / 2) - hy) > 8) continue
      // Approximate notehead left edge from its center anchor.
      const headLeft = hx - 5
      const overlapPx = accRight - headLeft
      if (overlapPx > 0.5) {
        out.push({ noteId: note.id, measureIndex, pitchIndex: pIdx, headIndex: i, overlapPx: Number(overlapPx.toFixed(2)) })
      }
    }
  }
}

interface BuiltMeasure {
  realNotes: StaveNote[]
  voice: Voice | null
}

function buildMeasure(measure: Measure, timeSig: TimeSig, clef: Clef = 'treble'): BuiltMeasure {
  if (measure.notes.length === 0) return { realNotes: [], voice: null }

  const realNotes = measure.notes.map(ev => buildVexNote(ev, clef))
  const ghosts = buildGhostNotes(measureCapacity(timeSig) - measureBeatCount(measure))
  const voice = new Voice({ numBeats: timeSig.beats, beatValue: timeSig.beatType })
    .setStrict(false)
    .addTickables([...realNotes, ...ghosts])
  return { realNotes, voice }
}

// Walk backwards from idx to find the effective time sig (propagates forward from last change).
function effectiveTimeSigAt(measures: Measure[], idx: number, global: TimeSig): TimeSig {
  for (let i = idx; i >= 0; i--) {
    if (measures[i].timeSig) return measures[i].timeSig!
  }
  return global
}

function effectiveKeySigAt(measures: Measure[], idx: number, global: KeySig): KeySig {
  for (let i = idx; i >= 0; i--) {
    if (measures[i].keySig) return measures[i].keySig!
  }
  return global
}

export interface MeasureGeometry {
  x: number
  width: number
}

export interface NoteGeometry {
  id: string
  type: 'note' | 'rest'
  x: number            // notehead anchor x in SVG px
  cx: number           // glyph visual center x in SVG px (for centering rest overlays)
  leftX: number        // true left edge incl. accidentals/displaced heads (for cursor zone)
  rightX: number       // true right edge incl. dots/displaced heads
  y: number            // notehead y in SVG px (primary/lowest pitch for chords)
  ys: number[]         // every notehead y (all pitches of a chord) for hit testing
  xs: number[]         // every notehead x (incl. displaced 2nds), aligned 1:1 with ys
  measureIndex: number
}

export interface TempoMarkGeometry {
  x: number
  y: number
  tempo: number
  measureNumber: number
}

// Drawn position of a note's accidental or dot glyph, used to place drag handles
// when adjusting it. Center point in SVG px (same space as NoteGeometry).
export interface GlyphGeometry {
  noteId: string
  pitchIndex: number
  kind: 'accidental' | 'dot'
  x: number
  y: number
  w?: number
  h?: number
}

// Drawn shape of a slur/tie, used to place drag handles when editing.
export interface TieGeometry {
  id: string
  startX: number
  startY: number
  endX: number
  endY: number
  cp1: number
  direction: number   // 1 = bulge down, -1 = bulge up
}

export interface StaffLayout {
  width: number
  height: number
  measures: MeasureGeometry[]
  notes: NoteGeometry[]
  glyphs: GlyphGeometry[]
  tempoMarks: TempoMarkGeometry[]
  ties: TieGeometry[]
}

export interface RenderScoreOptions {
  container: HTMLElement
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  clef?: Clef
  ties?: Tie[]
  staveY?: number
  initialTempo?: number
  tempoChanges?: { measureNumber: number; tempo: number }[]
  // Pre-computed stave widths (used for synchronized grand staff columns).
  forcedStaveWidths?: number[]
}

export function renderStaff({
  container,
  measures,
  timeSig,
  keySig,
  clef = 'treble',
  ties = [],
  staveY = 48,
  initialTempo,
  tempoChanges = [],
  forcedStaveWidths,
}: RenderScoreOptions): StaffLayout {
  container.innerHTML = ''
  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  const ctx = renderer.getContext()

  // Compute effective per-measure sigs (walk-backwards propagation).
  const effTimeSigs = measures.map((_, i) => effectiveTimeSigAt(measures, i, timeSig))
  const effKeySigs  = measures.map((_, i) => effectiveKeySigAt(measures, i, keySig))

  // Pass 1 — build voices and compute note-area widths.
  const built = measures.map((m, i) => buildMeasure(m, effTimeSigs[i], clef))
  const vexMins: number[] = []
  const rawWidths = built.map(({ realNotes, voice }) => {
    if (!voice) { vexMins.push(0); return MIN_NOTE_AREA }
    const { min, raw } = rawWidthFromVoice(realNotes, voice)
    vexMins.push(min)
    return raw
  })

  const maxWidth = Math.max(...rawWidths)
  const noteAreaWidths = rawWidths.map((w, i) => {
    const blended = Math.round(w + BLEND_FACTOR * (maxWidth - w))
    return Math.max(blended, Math.ceil(vexMins[i]))
  })

  // Compute decoration allowance per measure.
  const decorAllowance = measures.map((_, i) => {
    if (i === 0) return FIRST_MEASURE_ALLOWANCE
    const prevKey = effKeySigs[i - 1]
    const curKey  = effKeySigs[i]
    const prevTs  = effTimeSigs[i - 1]
    const curTs   = effTimeSigs[i]
    const keyChanged = prevKey.fifths !== curKey.fifths
    const tsChanged  = prevTs.beats !== curTs.beats || prevTs.beatType !== curTs.beatType
    return (keyChanged ? KEY_CHANGE_ALLOWANCE : 0) + (tsChanged ? TIME_CHANGE_ALLOWANCE : 0)
  })

  const staveWidths: number[] = forcedStaveWidths
    ? forcedStaveWidths.slice(0, measures.length)
    : measures.map((_, idx) => noteAreaWidths[idx] + NOTE_PAD + decorAllowance[idx])

  const totalWidth = LEFT_MARGIN + staveWidths.reduce((a, b) => a + b, 0) + RIGHT_MARGIN
  renderer.resize(totalWidth, STAFF_HEIGHT)

  // Pass 2 — layout and draw.
  const geometry: MeasureGeometry[] = []
  const noteGeometry: NoteGeometry[] = []
  const glyphGeometry: GlyphGeometry[] = []
  const intraChordConflicts: Array<{ noteId: string; measureIndex: number; pitchIndex: number; headIndex: number; overlapPx: number }> = []
  const tempoMarkGeometry: TempoMarkGeometry[] = []
  const vexById = new Map<string, StaveNote>()
  let x = LEFT_MARGIN

  measures.forEach((measure, idx) => {
    const staveWidth  = staveWidths[idx]
    const effTimeSig  = effTimeSigs[idx]
    const effKeySig   = effKeySigs[idx]
    const prevKeySig  = idx > 0 ? effKeySigs[idx - 1] : null
    const prevTimeSig = idx > 0 ? effTimeSigs[idx - 1] : null

    const stave = new Stave(x, staveY, staveWidth, { spacingBetweenLinesPx: 12 })

    if (idx === 0) {
      stave.addClef(clef)
      // Key sig on first measure (skip 'C' to avoid empty key sig display for C major).
      if (effKeySig.fifths !== 0) {
        stave.addKeySignature(fifthsToVexKey(effKeySig.fifths))
      }
      stave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
    } else {
      // Show key sig change with courtesy naturals from previous key.
      const keyChanged = prevKeySig && prevKeySig.fifths !== effKeySig.fifths
      if (keyChanged) {
        const newKey  = fifthsToVexKey(effKeySig.fifths)
        const oldKey  = fifthsToVexKey(prevKeySig!.fifths)
        stave.addKeySignature(newKey, oldKey)
      }
      // Show time sig change.
      const tsChanged = prevTimeSig && (prevTimeSig.beats !== effTimeSig.beats || prevTimeSig.beatType !== effTimeSig.beatType)
      if (tsChanged) {
        stave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
      }
    }

    stave.setContext(ctx).draw()
    drawLedgerGuides(ctx, stave)

    // Tempo marking above the stave.
    const tempoAtMeasure = getTempoAtMeasure(measure.number, initialTempo, tempoChanges)
    const showTempo =
      (idx === 0 && initialTempo !== undefined) ||
      tempoChanges.some(tc => tc.measureNumber === measure.number)
    if (showTempo && tempoAtMeasure !== undefined) {
      tempoMarkGeometry.push({ x, y: staveY, tempo: tempoAtMeasure, measureNumber: measure.number })
    }

    const { realNotes, voice } = built[idx]
    if (voice) {
      // Give every note its stave before formatting so VexFlow's accidental column
      // layout uses pixel-accurate line positions and clears displaced noteheads.
      voice.getTickables().forEach(t => t.setStave(stave))
      const formatWidth = stave.getNoteEndX() - stave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([voice]).format([voice], Math.max(noteAreaWidths[idx], formatWidth))

      const beams = Beam.generateBeams(realNotes)
      // Apply manual accidental/dot nudges on top of auto layout before drawing.
      measure.notes.forEach((ev, k) => { if (ev.type === 'note') applyGlyphOffsets(realNotes[k], ev) })
      voice.draw(ctx, stave)
      beams.forEach(b => b.setContext(ctx).draw())

      measure.notes.forEach((ev, k) => {
        const vn = realNotes[k]
        vexById.set(ev.id, vn)
        // For chords, record the primary (lowest) notehead Y.
        const ys = vn.getYs()
        const ax = vn.getAbsoluteX()
        const ext = noteExtents(vn)
        noteGeometry.push({
          id: ev.id,
          type: ev.type,
          x: ax,
          cx: ev.type === 'rest' ? glyphCenterX(vn) : noteheadCenterX(vn),
          leftX: ax - ext.accLeft,
          rightX: ax + ext.rightExt,
          y: ys[0] ?? staveY,
          ys: ys.length ? [...ys] : [staveY],
          xs: noteHeadXs(vn, ax),
          measureIndex: idx,
        })
        if (ev.type === 'note') {
          collectGlyphGeometry(vn, ev, glyphGeometry)
          collectIntraChordAccidentalConflicts(vn, ev, idx, intraChordConflicts)
        }
      })
    }

    geometry.push({ x, width: staveWidth })
    x += staveWidth
  })

  // Pass 3 — draw ties/slurs.
  const tieGeometry = drawTies(ties, measures, vexById, ctx)

  return {
    width: totalWidth,
    height: STAFF_HEIGHT,
    measures: geometry,
    notes: noteGeometry,
    glyphs: glyphGeometry,
    tempoMarks: tempoMarkGeometry,
    ties: tieGeometry,
  }
}

function getTempoAtMeasure(
  measureNumber: number,
  initialTempo: number | undefined,
  tempoChanges: { measureNumber: number; tempo: number }[],
): number | undefined {
  let result = initialTempo
  for (const tc of tempoChanges) {
    if (tc.measureNumber <= measureNumber) result = tc.tempo
    else break
  }
  return result
}

// ──────────────────────────────────────────────────────────────────────────────
// Grand Staff rendering (piano: treble + bass linked, with brace)
// ──────────────────────────────────────────────────────────────────────────────

export const GRAND_TREBLE_Y = 36
export const GRAND_BASS_Y = 192   // +36px gap vs prior 156 — more space between staves
export const GRAND_STAFF_HEIGHT = 348

export interface GrandStaffLayout {
  width: number
  height: number
  measures: MeasureGeometry[]
  trebleNotes: NoteGeometry[]
  bassNotes: NoteGeometry[]
  trebleGlyphs: GlyphGeometry[]
  bassGlyphs: GlyphGeometry[]
  tempoMarks: TempoMarkGeometry[]
  trebleTies: TieGeometry[]
  bassTies: TieGeometry[]
}

export interface RenderGrandStaffOptions {
  container: HTMLElement
  trebleMeasures: Measure[]
  bassMeasures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  trebleTies?: Tie[]
  bassTies?: Tie[]
  initialTempo?: number
  tempoChanges?: { measureNumber: number; tempo: number }[]
  // Pre-computed stave widths for system-wide alignment across all parts.
  forcedStaveWidths?: number[]
}

export function renderGrandStaff({
  container,
  trebleMeasures,
  bassMeasures,
  timeSig,
  keySig,
  trebleTies = [],
  bassTies = [],
  initialTempo,
  tempoChanges = [],
  forcedStaveWidths,
}: RenderGrandStaffOptions): GrandStaffLayout {
  container.innerHTML = ''
  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  const ctx = renderer.getContext()

  const count = Math.max(trebleMeasures.length, bassMeasures.length)

  // Effective sigs for each measure across both staves (treble drives, since they're linked).
  const effTimeSigs = trebleMeasures.map((_, i) => effectiveTimeSigAt(trebleMeasures, i, timeSig))
  const effKeySigs  = trebleMeasures.map((_, i) => effectiveKeySigAt(trebleMeasures, i, keySig))

  // Build voices for both staves.
  const trebleBuilt = trebleMeasures.map((m, i) => buildMeasure(m, effTimeSigs[i], 'treble'))
  const bassBuilt   = bassMeasures.map((m, i) => buildMeasure(m, effTimeSigs[i] ?? timeSig, 'bass'))

  // Compute per-measure note-area widths — take max of treble and bass so columns align.
  function computeRawWidths(built: BuiltMeasure[]): number[] {
    return built.map(({ realNotes, voice }) => {
      if (!voice) return MIN_NOTE_AREA
      return rawWidthFromVoice(realNotes, voice).raw
    })
  }

  const trebleRaw = computeRawWidths(trebleBuilt)
  const bassRaw   = computeRawWidths(bassBuilt)
  const syncRaw   = Array.from({ length: count }, (_, i) => Math.max(trebleRaw[i] ?? MIN_NOTE_AREA, bassRaw[i] ?? MIN_NOTE_AREA))
  const maxWidth  = Math.max(...syncRaw)
  const noteAreaWidths = syncRaw.map(w => Math.round(w + BLEND_FACTOR * (maxWidth - w)))

  const decorAllowance = Array.from({ length: count }, (_, i) => {
    if (i === 0) return FIRST_MEASURE_ALLOWANCE + 20 // extra for brace
    const prevKey = effKeySigs[i - 1]
    const curKey  = effKeySigs[i]
    const prevTs  = effTimeSigs[i - 1]
    const curTs   = effTimeSigs[i]
    const keyChanged = prevKey && prevKey.fifths !== curKey.fifths
    const tsChanged  = prevTs && (prevTs.beats !== curTs.beats || prevTs.beatType !== curTs.beatType)
    return (keyChanged ? KEY_CHANGE_ALLOWANCE : 0) + (tsChanged ? TIME_CHANGE_ALLOWANCE : 0)
  })

  const staveWidths = forcedStaveWidths
    ? forcedStaveWidths.slice(0, count)
    : Array.from({ length: count }, (_, i) => noteAreaWidths[i] + NOTE_PAD + decorAllowance[i])
  const totalWidth  = LEFT_MARGIN + staveWidths.reduce((a, b) => a + b, 0) + RIGHT_MARGIN
  renderer.resize(totalWidth, GRAND_STAFF_HEIGHT)

  const measureGeometry: MeasureGeometry[] = []
  const tempoMarkGeometry: TempoMarkGeometry[] = []
  const trebleNoteGeometry: NoteGeometry[] = []
  const bassNoteGeometry: NoteGeometry[] = []
  const trebleGlyphGeometry: GlyphGeometry[] = []
  const bassGlyphGeometry: GlyphGeometry[] = []
  const trebleIntraChordConflicts: Array<{ noteId: string; measureIndex: number; pitchIndex: number; headIndex: number; overlapPx: number }> = []
  const bassIntraChordConflicts: Array<{ noteId: string; measureIndex: number; pitchIndex: number; headIndex: number; overlapPx: number }> = []
  const trebleVexById = new Map<string, StaveNote>()
  const bassVexById   = new Map<string, StaveNote>()

  let x = LEFT_MARGIN

  for (let idx = 0; idx < count; idx++) {
    const staveWidth  = staveWidths[idx]
    const effTimeSig  = effTimeSigs[idx] ?? timeSig
    const effKeySig   = effKeySigs[idx] ?? keySig
    const prevKeySig  = idx > 0 ? effKeySigs[idx - 1] : null
    const prevTimeSig = idx > 0 ? effTimeSigs[idx - 1] : null

    // Treble stave
    const trebleStave = new Stave(x, GRAND_TREBLE_Y, staveWidth, { spacingBetweenLinesPx: 12 })
    // Bass stave
    const bassStave   = new Stave(x, GRAND_BASS_Y, staveWidth, { spacingBetweenLinesPx: 12 })

    if (idx === 0) {
      trebleStave.addClef('treble')
      bassStave.addClef('bass')
      if (effKeySig.fifths !== 0) {
        const vexKey = fifthsToVexKey(effKeySig.fifths)
        trebleStave.addKeySignature(vexKey)
        bassStave.addKeySignature(vexKey)
      }
      trebleStave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
      bassStave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
    } else {
      const keyChanged = prevKeySig && prevKeySig.fifths !== effKeySig.fifths
      if (keyChanged) {
        const newKey = fifthsToVexKey(effKeySig.fifths)
        const oldKey = fifthsToVexKey(prevKeySig!.fifths)
        trebleStave.addKeySignature(newKey, oldKey)
        bassStave.addKeySignature(newKey, oldKey)
      }
      const tsChanged = prevTimeSig && (prevTimeSig.beats !== effTimeSig.beats || prevTimeSig.beatType !== effTimeSig.beatType)
      if (tsChanged) {
        trebleStave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
        bassStave.addTimeSignature(`${effTimeSig.beats}/${effTimeSig.beatType}`)
      }
    }

    trebleStave.setContext(ctx).draw()
    bassStave.setContext(ctx).draw()
    drawLedgerGuides(ctx, trebleStave)
    drawLedgerGuides(ctx, bassStave)

    // Brace + barline connector on first measure.
    if (idx === 0) {
      const brace = new StaveConnector(trebleStave, bassStave)
      brace.setType(StaveConnector.type.BRACE)
      brace.setContext(ctx).draw()

      const leftBar = new StaveConnector(trebleStave, bassStave)
      leftBar.setType(StaveConnector.type.SINGLE_LEFT)
      leftBar.setContext(ctx).draw()
    }

    // Tempo marking
    const trebleMeasure = trebleMeasures[idx]
    if (trebleMeasure) {
      const showTempo =
        (idx === 0 && initialTempo !== undefined) ||
        tempoChanges.some(tc => tc.measureNumber === trebleMeasure.number)
      if (showTempo) {
        const tempo = getTempoAtMeasure(trebleMeasure.number, initialTempo, tempoChanges)
        if (tempo !== undefined) {
          tempoMarkGeometry.push({ x, y: GRAND_TREBLE_Y, tempo, measureNumber: trebleMeasure.number })
        }
      }
    }

    // Draw treble notes
    const { realNotes: trebleReal, voice: trebleVoice } = trebleBuilt[idx] ?? { realNotes: [], voice: null }
    if (trebleVoice) {
      trebleVoice.getTickables().forEach(t => t.setStave(trebleStave))
      const fw = trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([trebleVoice]).format([trebleVoice], Math.max(noteAreaWidths[idx], fw))
      const beams = Beam.generateBeams(trebleReal)
      trebleMeasures[idx]?.notes.forEach((ev, k) => { if (ev.type === 'note') applyGlyphOffsets(trebleReal[k], ev) })
      trebleVoice.draw(ctx, trebleStave)
      beams.forEach(b => b.setContext(ctx).draw())
      trebleMeasures[idx]?.notes.forEach((ev, k) => {
        const vn = trebleReal[k]
        trebleVexById.set(ev.id, vn)
        const tys = vn.getYs()
        const tax = vn.getAbsoluteX()
        const text = noteExtents(vn)
        trebleNoteGeometry.push({ id: ev.id, type: ev.type, x: tax, cx: ev.type === 'rest' ? glyphCenterX(vn) : noteheadCenterX(vn), leftX: tax - text.accLeft, rightX: tax + text.rightExt, y: tys[0] ?? GRAND_TREBLE_Y, ys: tys.length ? [...tys] : [GRAND_TREBLE_Y], xs: noteHeadXs(vn, tax), measureIndex: idx })
        if (ev.type === 'note') {
          collectGlyphGeometry(vn, ev, trebleGlyphGeometry)
          collectIntraChordAccidentalConflicts(vn, ev, idx, trebleIntraChordConflicts)
        }
      })
    }

    // Draw bass notes
    const { realNotes: bassReal, voice: bassVoice } = bassBuilt[idx] ?? { realNotes: [], voice: null }
    if (bassVoice) {
      bassVoice.getTickables().forEach(t => t.setStave(bassStave))
      const fw = bassStave.getNoteEndX() - bassStave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([bassVoice]).format([bassVoice], Math.max(noteAreaWidths[idx], fw))
      const beams = Beam.generateBeams(bassReal)
      bassMeasures[idx]?.notes.forEach((ev, k) => { if (ev.type === 'note') applyGlyphOffsets(bassReal[k], ev) })
      bassVoice.draw(ctx, bassStave)
      beams.forEach(b => b.setContext(ctx).draw())
      bassMeasures[idx]?.notes.forEach((ev, k) => {
        const vn = bassReal[k]
        bassVexById.set(ev.id, vn)
        const bys = vn.getYs()
        const bax = vn.getAbsoluteX()
        const bext = noteExtents(vn)
        bassNoteGeometry.push({ id: ev.id, type: ev.type, x: bax, cx: ev.type === 'rest' ? glyphCenterX(vn) : noteheadCenterX(vn), leftX: bax - bext.accLeft, rightX: bax + bext.rightExt, y: bys[0] ?? GRAND_BASS_Y, ys: bys.length ? [...bys] : [GRAND_BASS_Y], xs: noteHeadXs(vn, bax), measureIndex: idx })
        if (ev.type === 'note') {
          collectGlyphGeometry(vn, ev, bassGlyphGeometry)
          collectIntraChordAccidentalConflicts(vn, ev, idx, bassIntraChordConflicts)
        }
      })
    }

    measureGeometry.push({ x, width: staveWidth })
    x += staveWidth
  }

  // Draw ties for both staves
  const trebleTieGeometry = drawTies(trebleTies, trebleMeasures, trebleVexById, ctx)
  const bassTieGeometry   = drawTies(bassTies, bassMeasures, bassVexById, ctx)

  return {
    width: totalWidth,
    height: GRAND_STAFF_HEIGHT,
    measures: measureGeometry,
    trebleNotes: trebleNoteGeometry,
    bassNotes: bassNoteGeometry,
    trebleGlyphs: trebleGlyphGeometry,
    bassGlyphs: bassGlyphGeometry,
    tempoMarks: tempoMarkGeometry,
    trebleTies: trebleTieGeometry,
    bassTies: bassTieGeometry,
  }
}

function drawTies(
  ties: Tie[],
  measures: Measure[],
  vexById: Map<string, StaveNote>,
  ctx: ReturnType<InstanceType<typeof Renderer>['getContext']>,
): TieGeometry[] {
  const MAX_CP = 36
  const HALF_NOTEHEAD = 5
  const out: TieGeometry[] = []
  const flatEventIds = measures.flatMap(m => m.notes.map(ev => ev.id))
  const eventIdToIdx = new Map(flatEventIds.map((id, i) => [id, i] as [string, number]))
  const noteByIdFlat = new Map<string, Note>()
  for (const m of measures) {
    for (const ev of m.notes) {
      if (ev.type === 'note') noteByIdFlat.set(ev.id, ev)
    }
  }

  for (const tie of ties) {
    const first = vexById.get(tie.from.note)
    const last  = vexById.get(tie.to.note)
    if (!first || !last) continue
    try {
      const ov       = tie.curve
      const fromNote = noteByIdFlat.get(tie.from.note)
      const toNote   = noteByIdFlat.get(tie.to.note)
      // Resolve each endpoint to a single notehead index via its stable Pitch.id. Pitches
      // map to StaveNote keys in pitch-array order (see buildVexNote), so the array index
      // IS the notehead index. Skip the tie if either head no longer exists (e.g. deleted).
      const fromIdx = fromNote?.pitches.findIndex(p => p.id === tie.from.pitch) ?? -1
      const toIdx   = toNote?.pitches.findIndex(p => p.id === tie.to.pitch)   ?? -1
      if (fromIdx < 0 || toIdx < 0) continue
      const firstIndexes = [fromIdx]
      const lastIndexes  = [toIdx]

      // Tie vs. slur: a tie when the two connected heads share a pitch (same sounding
      // note sustained), otherwise a slur (legato between different pitches).
      const isTie = !!fromNote && !!toNote && samePitch(fromNote.pitches[fromIdx], toNote.pitches[toIdx])
      const iFrom    = eventIdToIdx.get(tie.from.note) ?? -1
      const iTo      = eventIdToIdx.get(tie.to.note)   ?? -1
      const lo = Math.min(iFrom, iTo)
      const hi = Math.max(iFrom, iTo)

      let stemsUp = 0, stemsDown = 0
      for (let k = lo; k <= hi; k++) {
        const vn = vexById.get(flatEventIds[k])
        if (vn) vn.getStemDirection() === 1 ? stemsUp++ : stemsDown++
      }
      const direction = ov?.direction ?? (stemsUp >= stemsDown ? 1 : -1)

      const staveTie  = new StaveTie({ firstNote: first, lastNote: last, firstIndexes, lastIndexes })
      staveTie.setDirection(direction)

      const pixelSpan   = Math.abs(last.getAbsoluteX() - first.getAbsoluteX())
      const spanBasedCp = isTie ? 6 : pixelSpan < 60 ? 8 : pixelSpan < 180 ? 14 : 22
      const tolerance   = pixelSpan < 60 ? -2 : pixelSpan < 180 ? 0 : 3

      // Per-notehead endpoint Ys. flattenedEndpointYs returns the full notehead arrays for
      // ties (untouched) and a flattened index-0 for slurs. StaveTie.renderTie indexes these
      // by firstIndexes/lastIndexes, so each tied pitch arches from its own notehead.
      const { firstYs: baseFirstYs, lastYs: baseLastYs } = flattenedEndpointYs(first, last, !!isTie, fromIdx, toIdx)
      const flatFirstYs = [...baseFirstYs]
      const flatLastYs  = [...baseLastYs]
      // Manual vertical shift nudges every tied notehead uniformly.
      if (ov?.startDY) for (const i of firstIndexes) flatFirstYs[i] = (flatFirstYs[i] ?? 0) + ov.startDY
      if (ov?.endDY)   for (const i of lastIndexes)  flatLastYs[i]  = (flatLastYs[i]  ?? 0) + ov.endDY
      staveTie.getFirstYs = () => flatFirstYs
      staveTie.getLastYs  = () => flatLastYs

      // Representative endpoint for hit-testing/drag handles: the outermost tied notehead on
      // the side the arch bulges toward (top notehead for an upward tie, bottom for downward).
      const repPick = (idxs: number[], ys: number[]): number => {
        let best = idxs[0]
        for (const i of idxs) {
          const yi = ys[i] ?? 0, yb = ys[best] ?? 0
          if (direction === 1 ? yi > yb : yi < yb) best = i
        }
        return best
      }
      const repFirstIdx = repPick(firstIndexes, flatFirstYs)
      const repLastIdx  = repPick(lastIndexes,  flatLastYs)

      // Pull the end inward past the end note's leading accidental so the incoming
      // curve clears it instead of crossing over the glyph. Negligible heads ignored.
      const endAcc      = noteExtents(last).accLeft
      const endAccShift = endAcc > 2 ? endAcc : 0

      // Manual horizontal endpoint shifts (additive on top of the accidental clearance).
      if (ov?.startDX) staveTie.renderOptions.firstXShift = ov.startDX
      staveTie.renderOptions.lastXShift = (ov?.endDX ?? 0) - endAccShift

      const firstY = flatFirstYs[repFirstIdx] ?? 0
      const lastY  = flatLastYs[repLastIdx]   ?? 0
      const firstX = first.getAbsoluteX()
      const spanPx = (last.getAbsoluteX() - firstX) || 1
      let contentBasedCp = 0
      for (let k = lo + 1; k < hi; k++) {
        const vn = vexById.get(flatEventIds[k])
        if (!vn) continue
        if (!vn.getYs().length) continue
        const centreY = extremeYTowardSlur(vn, direction)
        const edgeY   = centreY + direction * HALF_NOTEHEAD
        const t       = Math.max(0.05, Math.min(0.95, (vn.getAbsoluteX() - firstX) / spanPx))
        const yLine   = (1 - t) * firstY + t * lastY
        const excess  = (edgeY - yLine) * direction - tolerance
        if (excess > 0) {
          const needed = excess / (2 * t * (1 - t))
          if (needed > contentBasedCp) contentBasedCp = needed
        }
      }

      const cp1 = ov?.cp1 ?? Math.min(MAX_CP, Math.max(spanBasedCp, contentBasedCp))
      const cp2 = ov?.cp2 ?? cp1 + 4
      staveTie.renderOptions.cp1 = cp1
      staveTie.renderOptions.cp2 = cp2
      staveTie.setContext(ctx).draw()

      out.push({
        id: tie.id,
        startX: firstX + (ov?.startDX ?? 0),
        startY: firstY,
        endX: last.getAbsoluteX() + (ov?.endDX ?? 0) - endAccShift,
        endY: lastY,
        cp1,
        direction,
      })
    } catch (err) {
      console.error('Failed to draw tie', tie, err)
    }
  }
  return out
}
