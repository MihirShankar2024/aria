import type { Pitch } from '../../types/score'
import { midiToPitch } from './renderer'

// Maps a Y pixel offset within a treble clef stave to a MIDI note.
// staveY is the top of the stave box; lineSpacing is pixels between lines (default 10).
// The top line of a treble stave is F5 (MIDI 77). Each half-step down = lineSpacing/2 pixels down.
export function staffYToMidiPitch(
  clickY: number,
  staveY: number,
  lineSpacing = 10,
): number {
  // Top line of treble stave = F5 = MIDI 77
  const topLineMidi = 77
  const pixelsFromTop = clickY - staveY
  const halfStepsDown = Math.round(pixelsFromTop / (lineSpacing / 2))
  return Math.max(0, Math.min(127, topLineMidi - halfStepsDown))
}

export function staffYToPitch(clickY: number, staveY: number, lineSpacing = 10): Pitch {
  return midiToPitch(staffYToMidiPitch(clickY, staveY, lineSpacing))
}
