import type { Pitch } from '../types/score'

/** Fresh stable id for a newly created notehead. Transform helpers (transpose, enharmonic
 *  respell, diatonic step) must *preserve* the source pitch's id instead of minting a new
 *  one, so a tie/slur attached to that head follows it across edits. */
export function newPitchId(): string {
  return crypto.randomUUID()
}

/** Backfill a stable id on any pitch missing one (legacy data loaded before per-notehead
 *  ids existed). Mutates in place and returns the same object for convenience. */
export function ensurePitchId(p: Pitch): Pitch {
  if (!p.id) p.id = newPitchId()
  return p
}
