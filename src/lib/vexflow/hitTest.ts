import type { Pitch, Clef } from '../../types/score'

// VexFlow Stave internals: new Stave(x, y, width) places the TOP LINE at
// y + spaceAboveStaffLn * lineSpacing = y + 4*10 = y + 40
export const VEXFLOW_HEADROOM = 4    // spaceAboveStaffLn (VexFlow default)
export const LINE_SPACING = 10       // px between staff lines (VexFlow default)
export const STAVE_TOP_OFFSET = VEXFLOW_HEADROOM * LINE_SPACING  // 40px

// ── Treble clef ──────────────────────────────────────────────────────────────
// Top line = F5, steps down: F E D C B A G (repeating)
const TREBLE_STEPS = ['F', 'E', 'D', 'C', 'B', 'A', 'G'] as const

function trebleDiatonicStep(stepsDown: number): { step: string; octave: number } {
  const n = stepsDown + 70
  const cycle = Math.floor(n / 7)
  const pos = n % 7
  const octave = 15 - cycle - (pos >= 4 ? 1 : 0)
  return { step: TREBLE_STEPS[pos], octave }
}

// ── Bass clef ─────────────────────────────────────────────────────────────────
// Top line = A3, steps down: A G F E D C B (repeating)
const BASS_STEPS = ['A', 'G', 'F', 'E', 'D', 'C', 'B'] as const

function bassDiatonicStep(stepsDown: number): { step: string; octave: number } {
  const n = stepsDown + 70
  const cycle = Math.floor(n / 7)
  const pos = n % 7
  // A3 at stepsDown=0: n=70, cycle=10, pos=0 → 13-10=3 ✓
  // B2 at stepsDown=6: n=76, cycle=10, pos=6 → 13-10-1=2 ✓
  const octave = 13 - cycle - (pos >= 6 ? 1 : 0)
  return { step: BASS_STEPS[pos], octave }
}

/**
 * Convert a Y pixel coordinate (relative to the VexFlow SVG container) to a
 * diatonic pitch with accidental=null, respecting the given clef.
 *
 * staveY is the `y` argument passed to `new Stave(x, y, width)`.
 */
export function staffYToPitch(
  clickY: number,
  staveY: number,
  clef: Clef = 'treble',
  lineSpacing = LINE_SPACING,
): Pitch {
  const topLineY = staveY + VEXFLOW_HEADROOM * lineSpacing
  const stepsDown = Math.round((clickY - topLineY) / (lineSpacing / 2))
  const { step, octave } = clef === 'bass' ? bassDiatonicStep(stepsDown) : trebleDiatonicStep(stepsDown)
  return {
    step: step as Pitch['step'],
    octave: Math.max(0, Math.min(8, octave)),
    accidental: null,
  }
}

/**
 * Given a diatonic stepsDown value, return the pixel Y of that staff position.
 * Inverse of the mapping above — used to snap the hover dot to the nearest line/space.
 */
export function staffStepToY(
  stepsDown: number,
  staveY: number,
  lineSpacing = LINE_SPACING,
): number {
  return staveY + VEXFLOW_HEADROOM * lineSpacing + stepsDown * (lineSpacing / 2)
}
