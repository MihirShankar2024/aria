# AI Phase — Plan

## Decision (locked)
The AI controls the project **like a user**:
- **READ:** the full native `Score` JSON (lossless — includes Layer-2 placement: `GlyphOffset`, `TieCurveOverride`, annotation anchors, scales). NOT a lossy MusicXML export.
- **WRITE:** a high-level **editing-intent vocabulary** (the same one the UI uses), executed through the **same reducer** a user's clicks flow through.

Consequence: MusicXML stops being the AI channel. The Category-A round-trip losses (ties/chords/articulations/tempo/voices dropped in MusicXML) demote from "AI is blind" blockers to **file import/export fidelity bugs** (lower priority).

## Decisions (locked 2026-06-29)
- **Edit flow:** propose -> user approves. AI tool calls produce a previewed suggestion/diff; nothing hits the score until accepted. Reuse existing suggestion UI.
- **Phase 0 scope:** refactor `StaffCanvas.tsx` onto the shared `commands.*` layer (not built alongside) — the only thing that proves the AI layer behaves identically to a human.
- **Ears scope:** build the FULL analysis suite (Phase 1.5) before enabling AI write (Phase 2). New ordering: 0 -> 1 -> 1.5 -> 2 -> 3.
- **Models:** Opus 4.8 (`claude-opus-4-8`) for composition/edit reasoning; Haiku (`claude-haiku-4-5`) for the deterministic-tool-driven analysis calls.

## Context & caching strategy (locked — enforce from Phase 1)
The model is STATELESS — background must be sent every request, but prompt caching makes the repeat ~0.1x.
Caching is a PREFIX MATCH: any byte change in the prefix invalidates everything after it.
- **Frozen system block (cached, written once):** `Score` schema + command vocabulary + rules + tool schemas.
  Author in code (git is our versioning). Must be byte-stable — NO interpolated score, measure numbers,
  timestamps, IDs, or per-request flags.
- **Volatile, AFTER the cache point (in `messages`):** the current `Score` JSON, cursor/selection, the user's request.
- **NOT Managed Agents.** That surface hosts a server-side container loop (bash/file/code in a sandbox); Aria is
  client-orchestrated tool use over in-browser state with a human approval gate. Wrong fit — all cost, no benefit.
- Verify caching via `usage.cache_read_input_tokens` > 0 on repeat calls. Put `cache_control` on the last system block.
- Consequence for Phase 1: current `useAiPanel.ts` interpolates measure numbers + full MusicXML INTO the system
  prompt every call — that defeats caching. Rewrite so schema/vocab/rules are frozen; score+selection go in the user turn.

## Keystone problem
"Act like a user" intelligence is split:
- `StaffCanvas.tsx` owns the intent->action decision tree (chord vs insert vs replace-rest vs append) AND the `noteCanFit` capacity guard for the ADD/INSERT paths.
- `scoreReducer.ts` guards only `REPLACE_*`, and always runs `normalizeByVoice`/`pruneTuplets`.

If the AI emits raw low-level actions it bypasses `noteCanFit` (overfills) and must re-derive the decision tree -> diverges from user behavior. So the editing intent must become one shared headless layer.

## Phase 0 — Shared editing-intent layer (the keystone)
- [ ] Create `src/lib/editing/commands.ts` (pure/headless). Functions mirror user intents and return `ScoreAction[]` or a typed rejection:
      `placeNote`, `placeRest`, `addChordNote`, `replaceWithRest`, `placeTupletNote`, `addSlurOrTie`, `setArticulation`,
      `addMarking`, `setTimeSig`, `setKeySig`, `setTempo`, `addMeasures`, `createTuplet`, ...
- [ ] **Voice-aware entry:** every entry command takes an explicit `voice: VoiceNumber` (default 1).
      Today the target voice is implicit toolbar/keyboard state (`activeVoice`; Alt -> voice 2 at StaffCanvas:1234)
      — the AI has no toolbar, so make it a parameter. Move the chord-vs-new-voice proximity rule with it
      (a note placed near voice-1 while targeting voice 2 starts an INDEPENDENT voice, does NOT chord onto voice 1 —
      StaffCanvas:1283). New commands: `setEventVoice` (move an event 1<->2), `clearVoice` (drop voice 2 in a measure).
- [ ] **Generalized markings:** replace `setDynamic`/`addAnnotation` with one `addMarking({kind: 'glyph'|'line'|'text', ...})`
      covering dynamics (glyph, e.g. symbolId `dyn.sfz`), ornaments, hairpins (line), and text — all -> `ADD_ANNOTATION`.
      Siblings: `removeMarking` (DELETE_ANNOTATION), `updateText` (UPDATE_TEXT_ANNOTATION).
      Target may be a measure OR an event (resolved to `measureX + dx` at the event's position).
      ACCEPTED LIMITATION: annotations anchor to measure+pixel, not beat (score.ts:142) — a marking targeted at an
      event follows the MEASURE, not that note, if the bar reflows/widens. True beat-anchoring = AnnotationAnchor
      model change, deferred (NOT Phase 0). AI must still never touch manual-placement fields.
- [ ] Move `noteCanFit` + the placement decision tree out of `StaffCanvas.tsx` into this module.
- [ ] Refactor `StaffCanvas.tsx` to call `commands.*` (proves the layer is faithful — manual editor must behave identically).
- [ ] Verify: manual note entry / chord / rest-replace / capacity-reject / voice-2 placement all still work unchanged.

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
### Phase 0 — core keystone landed (2026-06-29)
DONE & verified (build + typecheck + 16 vitest tests all green; zero new lint):
- `src/lib/editing/types.ts` — `CommandResult`, typed `Rejection`, `PartContext`, `PlacementAnchor`, param types.
  Commands take a `PartContext { partId, measures, globalTimeSig }` (NOT the whole Score) — matches how
  the editor reasons (placement is per-part) and lets StaffCanvas, which never holds the Score, call them.
- `src/lib/editing/commands.ts` — full vocabulary: placeNote/placeRest/replaceWithRest (decision tree lifted
  verbatim from `placeAt`), addChordNote/removeChordNote/deleteEvent, setEventVoice/clearVoice,
  addSlurOrTie/removeTie, setArticulation, addMarking/removeMarking, createTuplet/removeTuplet, and the
  structure/global wrappers. Cross-voice `near` anchor falls through to append (guards AI from chording
  across voices; mirrors StaffCanvas voice-filtered geometry).
- `StaffCanvas.placeAt` placement path refactored to geometry -> PlacementRequest -> placeNote/placeRest ->
  dispatch. `placementAppendedRef`/`pendingCenterRef`/`onPlaceFailed` side effects preserved exactly.
  `noteCanFit` import removed from StaffCanvas (now lives only in commands).
- vitest added (`pnpm test`); `commands.test.ts` covers append/chord/insert-fits/insert-overflow/replace-rest/
  append-overflow/voice-2-independent/unknown-measure/rest-replace/dup-chord/last-tone/tie-invalid/tie-ok/voice-move.

ROUTING (done 2026-06-29): tie-drag (StaffCanvas ~1210) -> `addSlurOrTie`; annotation drop (~1232) -> `addMarking`.
`buildTie` import dropped from StaffCanvas (now only inside commands). STILL in StaffCanvas by design:
tuplet entry (PLACE_TUPLET_NOTE — geometry-heavy, deferred) and modifier-tool glyph/UPDATE_NOTE ops (pixel-UI, out of scope).

AI PROMPT BOX (done 2026-06-29): `src/components/ai-panel/AiPromptBox.tsx` — floating bottom-right glass popup
(collapsed "Ask Aria" pill -> expanding textarea + send arrow; framer-motion + lucide; style from 21st.dev
"AI prompt Box"). Mounted in ScoreEditor with a stub `onSubmit` (echoes prompt + logs). This is the Phase 1–2
hook: the executor (native Score read -> Claude tool use -> commands.* -> dispatch) plugs into `onSubmit`.

REMAINING for full Phase 0:
- [ ] Manual browser parity check (needs user to click): note/chord/insert/rest-replace/capacity-flash/Alt-voice-2/
      tuplet entry/dynamic drop must match `main` exactly; confirm the prompt box opens/sends/collapses.
