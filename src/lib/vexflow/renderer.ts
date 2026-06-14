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
} from 'vexflow'
import type { Measure, Note, NoteEvent, Pitch, TimeSig, KeySig, Tie } from '../../types/score'
import { measureCapacity, measureBeatCount } from '../beats'

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

// Layout constants (no magic numbers buried in the draw loop).
const LEFT_MARGIN = 10
const RIGHT_MARGIN = 10
const NOTE_PAD = 24          // breathing room on each side of the note area
const CLEF_TS_ALLOWANCE = 64 // extra width the first measure needs for clef + time sig
const MIN_NOTE_AREA = 120    // smallest note area, so sparse measures aren't cramped
const MAX_NOTE_AREA = 400    // soft ceiling — dense bars won't exceed this unless content forces it
const SNAP_STEP = 32         // snap widths to multiples of this to prevent jitter
const SPACING_FACTOR = 1.5   // slack over the collision-free minimum → relaxed, metric feel
const BLEND_FACTOR = 0.35    // how far smaller bars are pulled toward the widest bar (0=independent, 1=uniform)
const STAFF_HEIGHT = 160

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step) * step
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

// Invisible placeholders that fill the empty beats remaining in a measure so the
// formatter spaces real notes at their metric positions (beat N at a stable
// fraction) instead of justifying them across the whole bar.
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
  const vn = new StaveNote({
    keys: [pitchToVexKey(note.pitch)],
    duration: durationToVex(note.duration, note.dots),
  })
  // Accidental first (renders immediately left of the notehead), then the dot
  // (which VexFlow places to the right) — order: accidental → notehead → dot.
  const vexAcc = accidentalToVex(note.pitch.accidental)
  if (vexAcc) vn.addModifier(new VexAccidental(vexAcc), 0)
  if (note.dots > 0) Dot.buildAndAttach([vn], { all: true })
  return vn
}

// One built measure: the real notes (for drawing + beaming) plus ghost fillers.
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

export interface MeasureGeometry {
  x: number      // left edge of the stave in SVG px
  width: number  // full stave width in px
}

/** Rendered position of one event, for hit-testing (drag-to-tie, future selection). */
export interface NoteGeometry {
  id: string
  type: 'note' | 'rest'
  x: number            // notehead x in SVG px
  y: number            // notehead y in SVG px
  measureIndex: number
}

export interface StaffLayout {
  width: number
  height: number
  measures: MeasureGeometry[]
  notes: NoteGeometry[]
}

export interface RenderScoreOptions {
  container: HTMLElement
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  ties?: Tie[]
  staveY?: number
}

export function renderStaff({ container, measures, timeSig, keySig: _keySig, ties = [], staveY = 40 }: RenderScoreOptions): StaffLayout {
  container.innerHTML = ''
  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  const ctx = renderer.getContext()

  // Pass 1 — build voices and compute an independent note-area width per measure.
  // Each bar is sized to its own content so editing one bar never reflows others,
  // and a dense bar (16ths + accidentals) only widens up to MAX_NOTE_AREA.
  // Widths snap to SNAP_STEP multiples so small edits don't cause micro-jitter.
  const built = measures.map(m => buildMeasure(m, timeSig))
  // Per-bar minimum widths (content-driven, capped, snapped).
  const vexMins: number[] = []
  const rawWidths = built.map(({ voice }) => {
    if (!voice) { vexMins.push(0); return MIN_NOTE_AREA }
    const min = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice])
    vexMins.push(min)
    const preferred = snapUp(Math.min(Math.max(Math.ceil(min * SPACING_FACTOR), MIN_NOTE_AREA), MAX_NOTE_AREA), SNAP_STEP)
    return Math.max(preferred, Math.ceil(min))
  })

  // Blend smaller bars toward the widest bar so extreme size differences look less jarring,
  // without fully equalizing them. blended = own + BLEND * (max - own).
  const maxWidth = Math.max(...rawWidths)
  const noteAreaWidths = rawWidths.map((w, i) => {
    const blended = Math.round(w + BLEND_FACTOR * (maxWidth - w))
    // Still must not go below VexFlow's collision minimum.
    return Math.max(blended, Math.ceil(vexMins[i]))
  })

  // Compute per-measure stave widths (first bar carries clef + time signature).
  const staveWidths = measures.map((_, idx) =>
    noteAreaWidths[idx] + NOTE_PAD + (idx === 0 ? CLEF_TS_ALLOWANCE : 0),
  )
  const totalWidth = LEFT_MARGIN + staveWidths.reduce((a, b) => a + b, 0) + RIGHT_MARGIN
  renderer.resize(totalWidth, STAFF_HEIGHT)

  // Pass 2 — lay out left to right and draw.
  const geometry: MeasureGeometry[] = []
  const noteGeometry: NoteGeometry[] = []
  const vexById = new Map<string, StaveNote>()  // event id → drawn StaveNote (for ties)
  let x = LEFT_MARGIN
  measures.forEach((measure, idx) => {
    const staveWidth = staveWidths[idx]
    const stave = new Stave(x, staveY, staveWidth)
    if (idx === 0) {
      stave.addClef('treble')
      stave.addTimeSignature(`${timeSig.beats}/${timeSig.beatType}`)
    }
    stave.setContext(ctx).draw()

    const { realNotes, voice } = built[idx]
    if (voice) {
      // Format to the stave's actual note area; the Formatter handles proportional
      // (metric) spacing and accidental/dot placement and collision avoidance.
      const formatWidth = stave.getNoteEndX() - stave.getNoteStartX() - NOTE_PAD
      new Formatter().joinVoices([voice]).format([voice], Math.max(noteAreaWidths[idx], formatWidth))

      // Beam real notes only, before draw, so flags are suppressed on beamed notes.
      const beams = Beam.generateBeams(realNotes)
      voice.draw(ctx, stave)
      beams.forEach(b => b.setContext(ctx).draw())

      // realNotes[k] corresponds 1:1 to measure.notes[k] — record positions + map ids.
      measure.notes.forEach((ev, k) => {
        const vn = realNotes[k]
        vexById.set(ev.id, vn)
        noteGeometry.push({
          id: ev.id,
          type: ev.type,
          x: vn.getAbsoluteX(),
          y: vn.getYs()[0] ?? staveY,
          measureIndex: idx,
        })
      })
    }

    geometry.push({ x, width: staveWidth })
    x += staveWidth
  })

  // Pass 3 — draw ties/slurs once all notes exist. A single StaveTie spans from
  // its `from` note to its `to` note, curving over any notes in between; VexFlow
  // handles cross-barline spans. Skip ties whose endpoints aren't present (e.g.
  // mid-edit orphans) so a stale tie never throws.
  for (const tie of ties) {
    const first = vexById.get(tie.from)
    const last = vexById.get(tie.to)
    if (!first || !last) continue
    try {
      new StaveTie({
        firstNote: first,
        lastNote: last,
        firstIndexes: [0],
        lastIndexes: [0],
      }).setContext(ctx).draw()
    } catch (err) {
      // A single malformed tie must never take down the whole staff render.
      console.error('Failed to draw tie', tie, err)
    }
  }

  return { width: totalWidth, height: STAFF_HEIGHT, measures: geometry, notes: noteGeometry }
}
