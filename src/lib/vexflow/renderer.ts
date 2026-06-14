import {
  Renderer,
  Stave,
  StaveNote,
  GhostNote,
  Voice,
  Formatter,
  Accidental as VexAccidental,
  Dot,
  Beam,
  StaveTie,
  StaveConnector,
} from 'vexflow'
import type { Measure, Note, Pitch, TimeSig, KeySig, Tie, Clef, NoteEvent, Part } from '../../types/score'
import { measureCapacity, measureBeatCount } from '../beats'

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.octave === b.octave && a.accidental === b.accidental
}

function pitchArraysEqual(a: Pitch[], b: Pitch[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => samePitch(p, b[i]))
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
): { firstYs: number[]; lastYs: number[] } {
  const firstYs = first.getYs()
  const lastYs = last.getYs()
  if (isTie) return { firstYs, lastYs }
  const fY = firstYs[0]
  const lY = lastYs[0]
  if (fY === undefined || lY === undefined || fY === lY) return { firstYs, lastYs }
  const mid = (fY + lY) / 2
  const newFirst = [...firstYs]
  const newLast = [...lastYs]
  newFirst[0] = fY + (mid - fY) * SLUR_ENDPOINT_FLATTEN
  newLast[0] = lY + (mid - lY) * SLUR_ENDPOINT_FLATTEN
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
export const STAFF_HEIGHT = 160

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
function computeColumnWidths(measures: Measure[], effTimeSigs: TimeSig[]): { raws: number[]; mins: number[] } {
  const mins: number[] = []
  const raws = measures.map((m, i) => {
    const { voice } = buildMeasure(m, effTimeSigs[i] ?? effTimeSigs[effTimeSigs.length - 1])
    if (!voice) { mins.push(0); return MIN_NOTE_AREA }
    const min = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice])
    mins.push(min)
    const preferred = snapUp(Math.min(Math.max(Math.ceil(min * SPACING_FACTOR), MIN_NOTE_AREA), MAX_NOTE_AREA), SNAP_STEP)
    return Math.max(preferred, Math.ceil(min))
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
    const { raws, mins } = computeColumnWidths(part.measures, effTs)
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
  return { step, octave, accidental: accidentals[semitone] }
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

function buildVexNote(event: NoteEvent): StaveNote {
  if (event.type === 'rest') {
    const vn = new StaveNote({ keys: ['b/4'], duration: durationToVex(event.duration, event.dots) + 'r' })
    if (event.dots > 0) Dot.buildAndAttach([vn], { all: true })
    return vn
  }
  const note = event as Note
  // Sort pitches low-to-high; VexFlow expects ascending order for chords.
  const keys = note.pitches.map(pitchToVexKey)
  const vn = new StaveNote({
    keys,
    duration: durationToVex(note.duration, note.dots),
  })
  // Attach accidentals per key index, then dots.
  note.pitches.forEach((pitch, idx) => {
    const vexAcc = accidentalToVex(pitch.accidental)
    if (vexAcc) vn.addModifier(new VexAccidental(vexAcc), idx)
  })
  if (note.dots > 0) Dot.buildAndAttach([vn], { all: true })
  return vn
}

interface BuiltMeasure {
  realNotes: StaveNote[]
  voice: Voice | null
}

function buildMeasure(measure: Measure, timeSig: TimeSig): BuiltMeasure {
  if (measure.notes.length === 0) return { realNotes: [], voice: null }

  const realNotes = measure.notes.map(buildVexNote)
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
  x: number            // notehead x in SVG px
  cx: number           // glyph visual center x in SVG px (for centering rest overlays)
  y: number            // notehead y in SVG px (primary/lowest pitch for chords)
  ys: number[]         // every notehead y (all pitches of a chord) for hit testing
  measureIndex: number
}

export interface TempoMarkGeometry {
  x: number
  y: number
  tempo: number
  measureNumber: number
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
  staveY = 40,
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
  const built = measures.map((m, i) => buildMeasure(m, effTimeSigs[i]))
  const vexMins: number[] = []
  const rawWidths = built.map(({ voice }) => {
    if (!voice) { vexMins.push(0); return MIN_NOTE_AREA }
    const min = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice])
    vexMins.push(min)
    const preferred = snapUp(Math.min(Math.max(Math.ceil(min * SPACING_FACTOR), MIN_NOTE_AREA), MAX_NOTE_AREA), SNAP_STEP)
    return Math.max(preferred, Math.ceil(min))
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
  const tempoMarkGeometry: TempoMarkGeometry[] = []
  const vexById = new Map<string, StaveNote>()
  let x = LEFT_MARGIN

  measures.forEach((measure, idx) => {
    const staveWidth  = staveWidths[idx]
    const effTimeSig  = effTimeSigs[idx]
    const effKeySig   = effKeySigs[idx]
    const prevKeySig  = idx > 0 ? effKeySigs[idx - 1] : null
    const prevTimeSig = idx > 0 ? effTimeSigs[idx - 1] : null

    const stave = new Stave(x, staveY, staveWidth)

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
      const formatWidth = stave.getNoteEndX() - stave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([voice]).format([voice], Math.max(noteAreaWidths[idx], formatWidth))

      const beams = Beam.generateBeams(realNotes)
      voice.draw(ctx, stave)
      beams.forEach(b => b.setContext(ctx).draw())

      measure.notes.forEach((ev, k) => {
        const vn = realNotes[k]
        vexById.set(ev.id, vn)
        // For chords, record the primary (lowest) notehead Y.
        const ys = vn.getYs()
        noteGeometry.push({
          id: ev.id,
          type: ev.type,
          x: vn.getAbsoluteX(),
          cx: glyphCenterX(vn),
          y: ys[0] ?? staveY,
          ys: ys.length ? [...ys] : [staveY],
          measureIndex: idx,
        })
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

export const GRAND_TREBLE_Y = 30
export const GRAND_BASS_Y = 130
export const GRAND_STAFF_HEIGHT = 280

export interface GrandStaffLayout {
  width: number
  height: number
  measures: MeasureGeometry[]
  trebleNotes: NoteGeometry[]
  bassNotes: NoteGeometry[]
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
  const trebleBuilt = trebleMeasures.map((m, i) => buildMeasure(m, effTimeSigs[i]))
  const bassBuilt   = bassMeasures.map((m, i) => buildMeasure(m, effTimeSigs[i] ?? timeSig))

  // Compute per-measure note-area widths — take max of treble and bass so columns align.
  function computeRawWidths(built: BuiltMeasure[]): number[] {
    const mins: number[] = []
    const raws = built.map(({ voice }) => {
      if (!voice) { mins.push(0); return MIN_NOTE_AREA }
      const min = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice])
      mins.push(min)
      const preferred = snapUp(Math.min(Math.max(Math.ceil(min * SPACING_FACTOR), MIN_NOTE_AREA), MAX_NOTE_AREA), SNAP_STEP)
      return Math.max(preferred, Math.ceil(min))
    })
    return raws
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
    const trebleStave = new Stave(x, GRAND_TREBLE_Y, staveWidth)
    // Bass stave
    const bassStave   = new Stave(x, GRAND_BASS_Y, staveWidth)

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
      const fw = trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([trebleVoice]).format([trebleVoice], Math.max(noteAreaWidths[idx], fw))
      const beams = Beam.generateBeams(trebleReal)
      trebleVoice.draw(ctx, trebleStave)
      beams.forEach(b => b.setContext(ctx).draw())
      trebleMeasures[idx]?.notes.forEach((ev, k) => {
        const vn = trebleReal[k]
        trebleVexById.set(ev.id, vn)
        const tys = vn.getYs()
        trebleNoteGeometry.push({ id: ev.id, type: ev.type, x: vn.getAbsoluteX(), cx: glyphCenterX(vn), y: tys[0] ?? GRAND_TREBLE_Y, ys: tys.length ? [...tys] : [GRAND_TREBLE_Y], measureIndex: idx })
      })
    }

    // Draw bass notes
    const { realNotes: bassReal, voice: bassVoice } = bassBuilt[idx] ?? { realNotes: [], voice: null }
    if (bassVoice) {
      const fw = bassStave.getNoteEndX() - bassStave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([bassVoice]).format([bassVoice], Math.max(noteAreaWidths[idx], fw))
      const beams = Beam.generateBeams(bassReal)
      bassVoice.draw(ctx, bassStave)
      beams.forEach(b => b.setContext(ctx).draw())
      bassMeasures[idx]?.notes.forEach((ev, k) => {
        const vn = bassReal[k]
        bassVexById.set(ev.id, vn)
        const bys = vn.getYs()
        bassNoteGeometry.push({ id: ev.id, type: ev.type, x: vn.getAbsoluteX(), cx: glyphCenterX(vn), y: bys[0] ?? GRAND_BASS_Y, ys: bys.length ? [...bys] : [GRAND_BASS_Y], measureIndex: idx })
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
    const first = vexById.get(tie.from)
    const last  = vexById.get(tie.to)
    if (!first || !last) continue
    try {
      const ov       = tie.curve
      const fromNote = noteByIdFlat.get(tie.from)
      const toNote   = noteByIdFlat.get(tie.to)
      const isTie    = fromNote && toNote && pitchArraysEqual(fromNote.pitches, toNote.pitches)
      const iFrom    = eventIdToIdx.get(tie.from) ?? -1
      const iTo      = eventIdToIdx.get(tie.to)   ?? -1
      const lo = Math.min(iFrom, iTo)
      const hi = Math.max(iFrom, iTo)

      let stemsUp = 0, stemsDown = 0
      for (let k = lo; k <= hi; k++) {
        const vn = vexById.get(flatEventIds[k])
        if (vn) vn.getStemDirection() === 1 ? stemsUp++ : stemsDown++
      }
      const direction = ov?.direction ?? (stemsUp >= stemsDown ? 1 : -1)
      const staveTie  = new StaveTie({ firstNote: first, lastNote: last, firstIndexes: [0], lastIndexes: [0] })
      staveTie.setDirection(direction)

      const pixelSpan   = Math.abs(last.getAbsoluteX() - first.getAbsoluteX())
      const spanBasedCp = isTie ? 6 : pixelSpan < 60 ? 8 : pixelSpan < 180 ? 14 : 22
      const tolerance   = pixelSpan < 60 ? -2 : pixelSpan < 180 ? 0 : 3

      // Endpoint Ys: flattened auto value plus any manual vertical shift.
      const { firstYs: baseFirstYs, lastYs: baseLastYs } = flattenedEndpointYs(first, last, !!isTie)
      const flatFirstYs = [...baseFirstYs]
      const flatLastYs  = [...baseLastYs]
      if (ov?.startDY) flatFirstYs[0] = (flatFirstYs[0] ?? 0) + ov.startDY
      if (ov?.endDY)   flatLastYs[0]  = (flatLastYs[0]  ?? 0) + ov.endDY
      staveTie.getFirstYs = () => flatFirstYs
      staveTie.getLastYs  = () => flatLastYs

      // Manual horizontal endpoint shifts.
      if (ov?.startDX) staveTie.renderOptions.firstXShift = ov.startDX
      if (ov?.endDX)   staveTie.renderOptions.lastXShift  = ov.endDX

      const firstY = flatFirstYs[0] ?? 0
      const lastY  = flatLastYs[0]  ?? 0
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
        endX: last.getAbsoluteX() + (ov?.endDX ?? 0),
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
