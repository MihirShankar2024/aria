# AI Phase — Plan

## Decision (locked)
The AI controls the project **like a user**:
- **READ:** the full native `Score` JSON (lossless — includes Layer-2 placement: `GlyphOffset`, `TieCurveOverride`, annotation anchors, scales). NOT a lossy MusicXML export.
- **WRITE:** a high-level **editing-intent vocabulary** (the same one the UI uses), executed through the **same reducer** a user's clicks flow through.

Consequence: MusicXML stops being the AI channel. The Category-A round-trip losses (ties/chords/articulations/tempo/voices dropped in MusicXML) demote from "AI is blind" blockers to **file import/export fidelity bugs** (lower priority).

## Keystone problem
"Act like a user" intelligence is split:
- `StaffCanvas.tsx` owns the intent->action decision tree (chord vs insert vs replace-rest vs append) AND the `noteCanFit` capacity guard for the ADD/INSERT paths.
- `scoreReducer.ts` guards only `REPLACE_*`, and always runs `normalizeByVoice`/`pruneTuplets`.

If the AI emits raw low-level actions it bypasses `noteCanFit` (overfills) and must re-derive the decision tree -> diverges from user behavior. So the editing intent must become one shared headless layer.

## Phase 0 — Shared editing-intent layer (the keystone)
- [ ] Create `src/lib/editing/commands.ts` (pure/headless). Functions mirror user intents and return `ScoreAction[]` or a typed rejection:
      `placeNote`, `placeRest`, `addChordNote`, `replaceWithRest`, `addSlurOrTie`, `setArticulation`,
      `addAnnotation`/`setDynamic`, `setTimeSig`, `setKeySig`, `setTempo`, `addMeasures`, `createTuplet`, ...
- [ ] Move `noteCanFit` + the placement decision tree out of `StaffCanvas.tsx` into this module.
- [ ] Refactor `StaffCanvas.tsx` to call `commands.*` (proves the layer is faithful — manual editor must behave identically).
- [ ] Verify: manual note entry / chord / rest-replace / capacity-reject all still work unchanged.

## Phase 1 — AI read path
- [ ] In `useAiPanel.ts`, replace `scoreToMusicXML(score)` with the full `Score` JSON + a compact cursor/selection context.
- [ ] System prompt teaches the `Score` schema + the command vocabulary.
- [ ] Keep `scoreToMusicXML` ONLY for file export.

## Phase 1.5 — Musical reasoning substrate (the AI's "ears")
Music theory is symbolic; the AI reasons better over structure than over audio. Don't make the
LLM be the music engine — give it resolved pitches + a sounding timeline + analysis tools it can call.
- [ ] Emit the playback schedule as DATA (refactor playback.ts/timeline.ts core): absolute time +
      resolved concert MIDI per note. This is the AI's "ears" — the SAME schedule the speakers get.
- [ ] Feed the AI resolved sounding pitches (`resolvePartAccidentals`), not raw step+accidental.
- [ ] Analysis tools (deterministic, AI-callable):
      `getSoundingTimeline(range)` (vertical sonorities + per-voice lines, MIDI+names),
      `analyzeHarmony(range)` (chords/Roman numerals/non-chord tones vs key),
      `findDissonances(range)` (m2/M7/tritone with locations),
      `checkVoiceLeading(range)` (parallel 5ths/8ves, leaps, out-of-key).
- [ ] Limit on record: objective issues caught reliably; subjective "sounds good/stylish" stays human-in-loop.

## Phase 2 — AI write path (tool use)
- [ ] Define Claude tool-use schemas = the command vocabulary from Phase 0.
- [ ] Executor: validate each tool call -> run through `commands.*` -> dispatch -> reducer. Surface rejections back to the AI.
- [ ] Remove dead `COMMIT_AI_SUGGESTION` case + unwired `musicXMLToScore` (or repurpose parser for file import only).

## Phase 3 — Close playback/export divergences (so AI hears/exports what it writes)
- [ ] Playback per-part time sig (currently reads `parts[0]` only — playback.ts:73).
- [ ] Playback honor articulations (staccato/fermata) + dynamics velocity (stretch).
- [ ] File fidelity (lower pri now): parser `<chord/>` handling; serialize/parse `part.ties` (tie+slur+stop), articulations, annotations, tempo; voices >2.
- [ ] Parts unequal measure length / measure-number alignment.

## Known accepted limitations (on record before build)
1. **Frozen tie/slur arch won't re-avoid NEW collisions.** A user-set `cp1` *replaces* the auto
   collision-avoidance value, so if the AI introduces a tall note poking under a hand-tuned arch,
   the arch follows positionally but won't re-grow to clear it. Pre-existing (same for manual edits).
2. **Annotations track their measure, not a beat within it.** Resolved as `measureX + dx` (fixed px
   from the measure's left edge). Travels with the measure across reflow/line-breaks, but if the AI
   *widens* a measure a dynamic may no longer sit under its original note. Pre-existing.
Both are accepted; the AI must NOT touch the manual-placement fields — they auto-follow at render time.

## Review
(filled in as phases complete)
