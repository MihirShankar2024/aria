import { renderStaff, type StaffLayout } from '../../lib/vexflow/renderer'
import type { TimeSig, KeySig, Duration, Accidental, Clef, Measure, NoteEvent, Pitch, VoiceNumber } from '../../types/score'

// A grey "held note/rest" preview that rides the cursor in placement mode. We
// render the currently-selected note/rest with the real engraving engine (so the
// notehead, stem, flag, dots and accidental match exactly what will be placed),
// strip the staff lines/clef, and hand back just the glyph SVG plus the notehead
// anchor so the caller can translate it under the cursor.
export interface GhostRender {
  html: string      // inner SVG markup of just the note/rest glyph
  anchorX: number   // notehead/glyph center x within the glyph's own coordinate space
  anchorY: number   // notehead/glyph center y within the glyph's own coordinate space
}

const GHOST_STAVE_Y = 48
// Flagged noteheads (8th/16th) render a hair left of the geometry center in the
// detached ghost overlay. Keep this manual nudge small and easy to tune.
const FLAGGED_NOTE_ANCHOR_X_OFFSET = -5

// One shared offscreen node — rendering the ghost must never touch the live canvas.
let scratch: HTMLDivElement | null = null
function scratchEl(): HTMLDivElement {
  if (!scratch) {
    scratch = document.createElement('div')
    scratch.style.cssText = 'position:absolute;left:-99999px;top:0;pointer-events:none;'
    document.body.appendChild(scratch)
  }
  return scratch
}

export interface GhostNoteOpts {
  duration: Duration
  dotted: boolean
  accidental: Accidental
  isRest: boolean
  clef: Clef
  timeSig: TimeSig
  keySig: KeySig
  voice?: VoiceNumber
}

export function renderGhostNote(opts: GhostNoteOpts): GhostRender | null {
  const { duration, dotted, accidental, isRest, clef, timeSig, keySig, voice = 1 } = opts
  // Neutral mid-staff pitch — pitch is irrelevant to the glyph shape, and the
  // caller re-centers the notehead on the cursor anyway.
  const finalPitch: Pitch = { id: 'ghost-pitch', step: 'B', octave: clef === 'bass' ? 3 : 4, accidental }
  const ev: NoteEvent = isRest
    ? { id: 'ghost', type: 'rest', duration, dots: dotted ? 1 : 0, voice }
    : { id: 'ghost', type: 'note', pitches: [finalPitch], duration, dots: dotted ? 1 : 0, tied: false, voice }
  const measure: Measure = { id: 'ghost', number: 1, notes: [ev] }

  const container = scratchEl()
  let layout: StaffLayout
  try {
    layout = renderStaff({ container, measures: [measure], timeSig, keySig, clef, staveY: GHOST_STAVE_Y })
  } catch {
    return null
  }
  const note = layout.notes[0]
  const svg = container.querySelector('svg')
  if (!note || !svg) return null

  // Drop the staff lines, clef, key sig and time sig (all drawn inside the
  // `vf-stave` group), leaving only the note/rest glyph (`vf-stavenote`).
  svg.querySelectorAll('.vf-stave').forEach(el => el.remove())
  // Barline rectangles and other measure furniture are NOT inside `.vf-stave`,
  // so explicitly extract only the note/rest glyph group plus stem elements.
  const stavenote = svg.querySelector('.vf-stavenote')
  const stems = Array.from(svg.querySelectorAll('.vf-stem'))
  // VexFlow glyphs are text-based (SMuFL). When we detach the stavenote group from
  // its source SVG, ensure note/rest symbols keep the same music font so they don't
  // degrade into tofu squares in the overlay preview.
  stavenote?.querySelectorAll('text').forEach(t => {
    if (!t.getAttribute('font-family')) t.setAttribute('font-family', 'Bravura,Academico,serif')
  })
  // Ensure isolated stems are visible in the ghost overlay.
  stems.forEach(stem => {
    stem.setAttribute('stroke', 'rgba(17,24,39,0.95)')
    stem.querySelectorAll('path').forEach(p => {
      p.setAttribute('stroke', 'rgba(17,24,39,0.95)')
      if (!p.getAttribute('stroke-width')) p.setAttribute('stroke-width', '1.5')
      if (!p.getAttribute('fill')) p.setAttribute('fill', 'none')
    })
  })
  const ghostHtml = [stavenote, ...stems]
    .filter((el): el is SVGElement => el instanceof SVGElement)
    .map(el => el.outerHTML)
    .join('') || svg.innerHTML

  const anchorX =
    !isRest && (duration === 'eighth' || duration === 'sixteenth')
      ? note.cx + FLAGGED_NOTE_ANCHOR_X_OFFSET
      : note.cx
  return { html: ghostHtml, anchorX, anchorY: note.y }
}
