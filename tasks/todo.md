# AI changes — pitch display, meter capacity, marking placement engine

## 1. AI talks/reads pitch in the user's DISPLAYED space (concert vs transposed view)  [SMALL]

`transposedView` (ScoreEditor:120, default true) renders transposing parts as WRITTEN pitch; the AI
always talks concert → mismatch. Snapshot stays concert (ids/anchors depend on it); only change how the
AI TALKS + interprets user-named pitches for transposing parts.

- [ ] `useAiAgent.send(..., transposedView)`; ScoreEditor passes its `transposedView` through AiPromptBox.
- [ ] `scoreForAi` head gains `pitchDisplay: 'concert' | 'written'` (via ScoreViewOpts).
- [ ] `systemPrompt.ts`: static "Talking about pitch" rule — when `pitchDisplay:'written'`, for a part
      with non-zero transposition, name pitches to the user in WRITTEN terms and read user pitches for
      that part as written (`pitchSpace:'written'`). Non-transposing / concert view unchanged.

## 2. Never overfill a measure (asked 6/8 → got 12/8)  [SMALL]

`noteCanFit` already rejects overfill on ENTRY; the bug is order-dependent — note calls folded BEFORE
the `setTimeSig` in the same turn validate against the old meter.

- [ ] `useAiAgent`: within one turn, stage STRUCTURAL/global calls (setTimeSig/Key/add/insert/remove
      Measures) into `working` BEFORE note-entry calls (results keyed by id, so result order is free).
- [ ] `systemPrompt.ts`: meter guidance — set time sig before writing; capacity = beats×4/beatType
      quarter-beats (6/8 = 3 quarter-beats = six eighths; 12 eighths = 12/8).

## 3. Marking placement engine — routed AFTER the AI, per user spec  [LARGE]

Decisions locked with user: anchor marks to an **event id**; **AI-created marks only** (manual drag
still overrides, like ties); **include grace/tremolo/gliss now** (all already catalog glyph/line
entries — this is event-anchored placement, not new rhythm entities); **skip rehearsal** for now.

### Placement spec (routing table)
| symbolId(s) | H anchor | V zone | notes |
|---|---|---|---|
| `dyn.*` (p/f/mf/…) | measure start (after sigs) | below lowest note | default below; flip above if below occupied |
| `dyn.sf*`,`fz`,`sfz*`,`rf*` (sforzando fam.) | applicable beat x (event) | under lowest note of that beat | shift right at bar start (clear sigs) |
| `text.tempo` | measure start (after sigs) | above staff | stack above |
| `text.*` (plain/expr/heading) | measure start | above highest note | stack above |
| `orn.trill/mordent*/turn*` (+ orn.acc*) | centered over the note | above note | trillExt line stretches |
| `orn.grace/appoggiatura` | left of the note | on note | |
| `orn.tremolo1-3` | on the note stem | on stem | |
| `orn.gliss`,`orn.trillExt` (lines) | event head → end event head | between heads | 2-endpoint |
| `orn.arpeggio` | left of note | spans chord height | existing vertical stretch |
| `sym.repeatBegin/End` | left of measure, after sigs | vertical staff center | |
| `sym.segno/coda/pedal*/simile/…` | top-left of measure/effect area | above staff | scale to fit |
| `measureNumber` | measure start | above staff | existing box |
Collision flow: within a measure, auto marks group by side (above/below), sort by priority, stack
OUTWARD so none overlap ("dynamics default below, above if already below" is the general rule).

### Data model — types/score.ts
- [ ] `AnnotationAnchor`: add optional `eventId?`, `pitchId?` (target note/head), `auto?: boolean`
      (auto-placed, not yet user-overridden). Line annotations: add optional end `endEventId?/endPitchId?`
      for gliss/trillExt notehead→notehead.

### Placement engine — new `src/lib/annotations/placement.ts`
- [ ] `placementRuleFor(ann): { h: HAnchor; v: Zone; scaleToFit?; twoEnd? }` — the switch keyed by
      kind + symbolId category (table above). Pure, unit-testable.
- [ ] `layoutMeasureMarks(autoMarks, geom)` — resolves each mark's (x,y) from geometry and stacks
      within zones to avoid overlap (the "flow"). Handles the below→above flip.

### Geometry — renderer + StaffCanvas
- [ ] renderer: add `noteStartX` to `MeasureGeometry` (`stave.getNoteStartX()`); add stem extent to
      `NoteGeometry` (`stemTopY`,`stemBottomY`) for over-note / under-note / on-stem placement.
- [ ] StaffCanvas: pass a geometry accessor to AnnotationsLayer (measure x-range + noteStartX + staff
      top/bottom; per-event x + note top/bottom + stem; per-measure highest/lowest note; resolve
      eventId→geometry).

### Layer — AnnotationsLayer.tsx
- [ ] For `anchor.auto` marks, compute (x,y) via `layoutMeasureMarks` instead of `mx+dx / staveY+dy`.
- [ ] Drag end → dispatch MOVE_ANNOTATION with concrete dx/dy; reducer clears `auto` (manual override,
      "until adjusted by user, like ties").

### AI path — tools.ts / executor.ts / systemPrompt.ts
- [ ] `addMarking` tool: drop dx/dy; add optional `eventId`/`pitchId` (+ `toEventId`/`toPitchId` for
      gliss). Executor sets `anchor.auto=true` + event refs; NO zone stored (derived from symbolId).
- [ ] System prompt: AI targets a NOTE for note-anchored marks (dynamics beat, ornaments, tremolo,
      gliss); never sets position. Add a `placeOrnament`/reuse addMarking guidance.

### Reducer — scoreReducer.ts
- [ ] MOVE_ANNOTATION clears `anchor.auto`. ADD_ANNOTATION unchanged.

## Verify
- [ ] `pnpm test` green (add `placement.test.ts` for the routing switch + stacking); `pnpm build` clean.
- [ ] Manual: transposed Bb trumpet → AI names written pitch; "6/8 melody" → six eighths at 6/8;
      dynamics below / text above / sforzando under beat / trill over note / no overlaps.

## Review
All three parts landed. Typecheck + build clean; 36 tests pass (10 new in placement.test.ts).

- **Part 1** — `send(...,transposedView)` (ScoreEditor→useAiAgent), `pitchDisplay` in the snapshot head,
  new "Talking about pitch" prompt rule. Snapshot stays concert; only the AI's wording/interpretation
  switches to written for transposing parts when the view is transposed.
- **Part 2** — agent loop now stages STRUCTURE_FIRST calls (setTimeSig/Key/measures) before note entry
  each turn, so capacity validates at the intended meter; prompt gained explicit meter-capacity guidance.
- **Part 3** — everything stays in the annotation model. `AnnotationAnchor` gained `auto/eventId/pitchId`
  (+ line `endEventId/endPitchId`); new `placement.ts` routes each mark type to an H-anchor + V-zone and
  stacks overlapping marks outward (dynamics flip above when below is taken; gliss connects noteheads).
  Renderer exposes `noteStartX` + stem extents; StaffCanvas builds `PlacementGeom` and resolves auto marks;
  AnnotationsLayer renders auto marks from the engine and bakes concrete dx/dy on drag (reducer clears
  `auto` → manual override, like ties). `addMarking` tool dropped dx/dy, added event targeting.

### Follow-ups / accepted limitations
- Grand-staff (piano) auto-placement uses single-staff Y constants — fine for the treble path; revisit if
  AI marks target the bass staff.
- Gliss/tremolo/grace use existing catalog glyphs/lines (not real rhythmic grace notes) — matches "place
  the mark," per the include-all-now decision.
- Overlap test is a horizontal-span heuristic (fixed widths), not exact glyph metrics.
- Manual browser QA still pending (needs `vercel dev` + ANTHROPIC_API_KEY for the live AI path).

## Fix: AI cloning notes / overflowing measures (2026-07-02)
**Symptom:** "compose a 4-bar melody" placed notes twice, spilled past bar 4, second pass placed only one.
**Root cause:** the score snapshot was sent to the model only once (first user message) and never
refreshed; edit tool results returned only `{ok, placedId}`. Across a multi-turn edit (place notes, then
add tremolo/dynamics/articulations referencing those ids next turn) the model still saw the ORIGINAL
empty-measure snapshot, so it re-emitted the placements → notes cloned; on the second pass the bars were
already full in the working copy → most appends rejected, spilling into fresh measures.
**Fix:** each successful per-part edit now echoes the touched bar's updated content
(`projectMeasureById`) in its tool result, so the model sees its own edits + the ids to anchor later
marks. System prompt updated to trust the echo over the stale snapshot and never re-place. Typecheck clean.

## Fix #2: Accept clones the edit (2026-07-02)
**Symptom:** optimistic preview correct, but pressing Accept applied the notes twice.
**Root cause:** `approve` called `dispatchBatch(...)` INSIDE the `setTurns` updater. Updater fns must be
pure; React StrictMode double-invokes them, so the BATCH dispatched twice — the second pass re-appended
the same notes (same ids) → visible clone. Preview folds the actions once, so it looked fine.
**Fix:** read staged actions from a new `turnsRef`, dispatch once in the handler body (not double-invoked),
then mark the turn approved in a pure updater. Guarded against re-approve. Typecheck clean.
