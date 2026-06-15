# Select-mode: move notes + click-to-select notehead

## Goal
1. After selecting note(s) in select mode, move them up/down on the staff with Arrow keys.
2. Clicking directly on a notehead selects that single note (no box drag needed).
3. Keep the rubber-band box selection working exactly as before.

## Design decisions
- **Move = diatonic step** (one staff line/space) per Arrow press, preserving each
  pitch's accidental. Visual + predictable; matches "up or down the bar".
  Up = ArrowUp, Down = ArrowDown. Octave-aware (B->C, C->B).
- Move applies to every selected note (chord pitches all shift together) as ONE
  undo step via `APPLY_MEASURE_NOTES` (ids preserved, selection stays intact).
- Notehead click = single select (replaces current selection). Box unchanged.

## Steps
- [ ] Add `stepPitch(pitch, dir)` diatonic-step helper (shared, in transpose.ts).
- [ ] ScoreEditor keydown: in select mode w/ selection, ArrowUp/Down -> build
      per-measure transposed edits -> dispatch APPLY_MEASURE_NOTES; keep selection.
- [ ] StaffCanvas.commitSelection: when box is a tiny click, hit-test noteheads
      (x near n.x, y near any n.ys); if hit -> select that one id, else clear.
- [ ] GrandStaffCanvas.commitSelection: same notehead hit-test (treble+bass).
- [ ] Guard StaffCanvas arrow handler to no-op in select mode (safety).
- [ ] Verify: tsc/build clean; manual sanity.

## Review
Implemented (final semantics per user):
- **Arrow keys** (ScoreEditor): in select mode with a selection, ArrowUp/Down nudge
  every selected note **chromatically** (±1 half step; **Shift = ±1 octave**), as one
  undo step. StaffCanvas's keyboard-cursor handler now no-ops in select mode.
- **Drag-move**: press on a notehead in select mode and drag vertically. Notes snap by
  staff position (diatonic) using the same vertical snapping as placement; a violet
  preview tracks the snapped target; released as one undo step. Drag whole selection if
  the grabbed note is already selected, else it grabs just that note.
- **Click a notehead** = select that single note (no box needed). Empty-staff drag still
  rubber-bands exactly as before; empty-staff click still clears selection.
- Helpers `transposeChromatic` / `diatonicStep` added to lib/transposition/transpose.ts.
- Mirrored in **both** StaffCanvas and GrandStaffCanvas (grand-staff drag moves notes
  across treble+bass together).

Verification: `tsc -b && vite build` passes; `npx tsc --noEmit` clean. New eslint hits
are the repo's pre-existing react-compiler rule noise (refs / setState-in-handler /
performance.now), matching surrounding code; lint is not part of the build.

Note: a selection spanning multiple separate parts moves all parts on Arrow keys, but a
*drag* only moves notes in the staff being dragged (grand-staff treble+bass move together).
