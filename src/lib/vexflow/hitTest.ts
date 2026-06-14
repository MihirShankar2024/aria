import type { Pitch } from '../../types/score'

// VexFlow Stave internals: new Stave(x, y, width) places the TOP LINE at
// y + spaceAboveStaffLn * lineSpacing = y + 4*10 = y + 40
// The current staveY constant is 40, so the actual top line is at pixel 80.
export const VEXFLOW_HEADROOM = 4    // spaceAboveStaffLn (VexFlow default)
export const LINE_SPACING = 10       // px between staff lines (VexFlow default)
export const STAVE_TOP_OFFSET = VEXFLOW_HEADROOM * LINE_SPACING  // 40px

// Diatonic mapping for treble clef starting from F5 (top line).
// stepsDown=0 → F5, 1 → E5, 2 → D5, 3 → C5, 4 → B4, 5 → A4, 6 → G4, 7 → F4 …
// Works for negative values (above the staff) via the +70 offset to avoid JS negative modulo.
const TREBLE_STEPS = ['F', 'E', 'D', 'C', 'B', 'A', 'G'] as const

function trebleDiatonicStep(stepsDown: number): { step: string; octave: number } {
  const n = stepsDown + 70 // shifts origin so n is always positive
  const cycle = Math.floor(n / 7)
  const pos = n % 7
  // F,E,D,C stay in the "upper" octave of the cycle; B,A,G belong to the one below
  const octave = 15 - cycle - (pos >= 4 ? 1 : 0)
  return { step: TREBLE_STEPS[pos], octave }
}

/**
 * Convert a Y pixel coordinate (relative to the VexFlow SVG container) to a
 * diatonic treble-clef pitch with accidental=null.
 *
 * staveY is the `y` argument passed to `new Stave(x, y, width)` — typically 40.
 * The actual top staff line is at staveY + STAVE_TOP_OFFSET (= staveY + 40).
 */
export function staffYToPitch(
  clickY: number,
  staveY: number,
  lineSpacing = LINE_SPACING,
): Pitch {
  const topLineY = staveY + VEXFLOW_HEADROOM * lineSpacing
  const stepsDown = Math.round((clickY - topLineY) / (lineSpacing / 2))
  const { step, octave } = trebleDiatonicStep(stepsDown)
  return {
    step: step as Pitch['step'],
    octave: Math.max(0, Math.min(8, octave)),
    accidental: null, // always natural by default; toolbar applies sharp/flat/natural
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
