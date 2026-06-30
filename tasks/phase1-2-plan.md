# Phases 1 → 1.5 → 2 → 3 — Implementation Plan (AI wiring)

Phase 0 built the hands (`src/lib/editing/commands.ts`) and the box (`AiPromptBox`). These phases
connect the brain: native `Score` read → Claude tool use → `commands.*` → reducer, behind a
propose→approve gate, with deterministic analysis tools as the AI's "ears".

## Architecture decision (locked): client-orchestrated loop, server is a thin relay

The score + reducer + `commands.*` live in the **browser**. The API key must stay **server-side**.
Therefore tool execution happens client-side and the agentic loop is client-owned; the Vercel
endpoint is a **stateless relay** that just proxies `messages.create`.

```
 AiPromptBox.onSubmit(prompt)
   └─> useAiAgent (client loop)
         1. build request: { model, system(cached), messages:[...history, {Score JSON + prompt}], tools }
         2. POST /api/claude  ──>  endpoint: client.messages.create(...) ──> returns full response
                                   (content blocks incl tool_use, stop_reason, usage)
         3. for each tool_use block:
              - ANALYSIS tool (read)  -> run deterministic client fn -> tool_result back into loop
              - EDIT tool (write)     -> commands.*() -> stage as a SuggestionDiff (NOT dispatched yet)
         4. if stop_reason==tool_use -> append tool_results, POST again (step 2). else done.
         5. present staged diff -> user Approve -> dispatch all actions / Reject -> drop
```

Two tool classes in the SAME loop:
- **Read/analysis tools** execute immediately, return data to Claude (the "ears"). No gate.
- **Edit tools** don't mutate the score mid-loop — they accumulate into a staged diff that the
  user approves once at the end (propose→approve). Claude still gets a synthetic "ok, staged"
  tool_result so it can continue planning a multi-step edit.

---

## Phase 1 — AI read path (native Score, cached prompt)

### 1.1 Rewrite the endpoint `api/claude.ts` into a tool-capable relay
- Accept `{ model, system, messages, tools }` (messages already shaped by the client, incl. tool_result
  blocks). Drop the `{systemPrompt,userMessage,history}` shape.
- `client.messages.create({ model, max_tokens, system, messages, tools })`.
- Return the FULL response: `{ content, stop_reason, usage }` (content = the raw block array, so the
  client sees `tool_use` blocks). No server-side tool loop.
- Keep Node runtime (SDK needs node:fs). Model comes from the client (default `claude-opus-4-8`).

### 1.2 New client request/response types (`src/types/api.ts`)
- Replace `ClaudeRequest`/`ClaudeResponse` with block-aware types mirroring the SDK
  (`role`, `content: ContentBlock[]`, `stop_reason`, `usage`). Reuse `@anthropic-ai/sdk` types where possible.
- Delete `AiSuggestion.responseMusicXML`; the suggestion now carries a staged `ScoreAction[]` diff
  (see Phase 2.3).

### 1.3 Native Score serialization for the prompt (`src/lib/ai/serializeForAi.ts`)
- `scoreForAi(score, selection)` → a compact JSON the model reads: parts/measures/events with ids,
  `step/octave/accidental`, duration/dots/voice, ties, annotations, time/key/tempo + a cursor/selection
  block (selected part ids + measure numbers + note ids). Include ids so the model can target events.
- This is the VOLATILE payload → goes in the **user message**, never the system prompt.

### 1.4 Frozen, cached system prompt (`src/lib/ai/systemPrompt.ts`)
- A byte-stable string: the `Score` schema explanation + the command vocabulary + behavioural rules
  (never touch GlyphOffset/TieCurveOverride/anchors; reject-and-explain on capacity; voices 1/2; etc.).
- Authored in code (git = versioning). NO interpolation of score/measures/timestamps/ids.
- Mark it cacheable: endpoint puts `cache_control: {type:'ephemeral'}` on the last system block (and on
  the tool list implicitly — tools render before system). Verify via `usage.cache_read_input_tokens` > 0.

### 1.5 Decommission the MusicXML AI channel
- `useAiPanel.ts` (old MusicXML path) → delete or fold into the new `useAiAgent`.
- Keep `scoreToMusicXML` for FILE EXPORT only. Remove dead `COMMIT_AI_SUGGESTION` reducer case +
  unwired `musicXMLToScore` (or repurpose parser for file import).

---

## Phase 1.5 — The "ears" (deterministic analysis substrate)

KEY: the sounding-pitch + MIDI + tie-merge logic ALREADY EXISTS in
`src/lib/audio/playback.ts::buildAndPlayScore` (resolvePartAccidentals + `(octave+1)*12+NOTE_MIDI+offset`
+ tie chain merge). Phase 1.5 extracts it as pure DATA so the AI hears exactly what the speakers do.

### 1.5.1 Extract the schedule as data (`src/lib/playback/schedule.ts`)
- `buildSoundingSchedule(score): ScheduledNote[]` where
  `ScheduledNote = { partId, noteId, pitchId, voice, midi, noteName, startBeat, startSec, durSec, tied }`.
- Move the resolve+MIDI+tie-merge core out of `buildAndPlayScore`; `buildAndPlayScore` now consumes
  `buildSoundingSchedule` and only does sampler scheduling. (Refactor-with-parity: playback must sound
  identical — same gate discipline as Phase 0.)

### 1.5.2 Analysis tools (pure, client-side, AI-callable) — `src/lib/ai/analysis.ts`
All read the Score/schedule, all deterministic (model-independent):
- `getSoundingTimeline(range)` — vertical sonorities + per-voice lines (MIDI + names) over a bar range.
- `analyzeHarmony(range)` — chord roots/qualities, Roman numerals vs. key, non-chord tones.
- `findDissonances(range)` — m2/M7/tritone with note-id locations.
- `checkVoiceLeading(range)` — parallel 5ths/8ves, large leaps, out-of-key tones.
- Each returns compact JSON for a tool_result. Unit-test each (vitest) on known fixtures.
- ON RECORD: objective issues are caught reliably; subjective "sounds good/stylish" stays human-in-loop.

---

## Phase 2 — AI write path (tool use + approve gate)

### 2.1 Tool schemas = the Phase 0 vocabulary (`src/lib/ai/tools.ts`)
- Define Claude tool-use JSON schemas, one per command the AI may call:
  EDIT: `placeNote, placeRest, replaceWithRest, addChordNote, removeChordNote, deleteEvent,
         setEventVoice, clearVoice, addSlurOrTie, removeTie, setArticulation, addMarking,
         createTuplet, removeTuplet, addMeasures, insertMeasures, removeMeasures,
         setTimeSig, setKeySig, setTempo, setTitle, addPart, addPianoPart, setPartInstrument`.
  READ: `getSoundingTimeline, analyzeHarmony, findDissonances, checkVoiceLeading`.
- Tool args are SEMANTIC (partId, measureId/number, pitch {step,octave,accidental}, duration, dots,
  voice, anchor). `strict: true` + `additionalProperties:false` so inputs validate exactly.
- Pitch targeting: the model references events by the ids from `scoreForAi`. `anchor` is
  `{kind:'append'}` or `{kind:'near', eventId}` — same as `commands.*`.

### 2.2 The executor (`src/lib/ai/executor.ts`)
- `executeToolCall(score, dispatchStaging, toolName, input): ToolOutcome`.
- Maps tool name → `commands.*`, building the `PartContext` from `score.parts[i]`.
- EDIT tools: run the command → on `ok`, append `actions` to the staged diff + return a success
  tool_result (incl. `placedId`); on reject, return the typed `Rejection` as the tool_result so Claude
  can adapt ("measure_full" → it tries a shorter duration). NOTHING dispatched yet.
- READ tools: call `analysis.*`, return data.
- Pure-ish: it appends to a staging buffer, doesn't touch the live reducer.

### 2.3 The agent hook (`src/hooks/useAiAgent.ts`)
- Owns the loop: build request (cached system + tools + Score-in-user-message + history) → POST relay
  → walk `content` blocks → execute tools via executor → if `stop_reason==='tool_use'` append
  tool_results and POST again (cap iterations, e.g. 8) → else stop.
- Accumulates: staged `ScoreAction[]`, the running transcript, Claude's final text (explanation),
  and `usage` (surface cache hit-rate for debugging).
- Returns `{ send, pending, stagedDiff, explanation, error, approve, reject }`.

### 2.4 Propose→approve UI (extend `AiPromptBox` + a diff preview)
- Replace the stub `onSubmit` with `useAiAgent.send`.
- On completion: show Claude's explanation + a compact summary of the staged diff
  ("+3 notes in bar 2, set 3/4 at bar 5") with **Approve** / **Reject**.
- Approve → dispatch every staged action in order (one undo step ideally — optional `BATCH` action) →
  clear staging. Reject → drop. Optional: highlight affected measures in the score on hover.
- Errors/rejections from Claude surface inline.

### 2.5 Cleanup
- Remove the dead `COMMIT_AI_SUGGESTION` case; retire `useAiPanel.ts`; delete `AiSuggestion.responseMusicXML`.

---

## Phase 3 — Close playback/export divergences (so AI hears/exports what it writes)

- Playback per-part time sig (currently reads `parts[0]` only — playback path): make the schedule
  honor each part's effective time sig.
- Playback honor articulations (staccato shortens, fermata holds) + dynamics → velocity (stretch).
- File fidelity (lower priority): MusicXML parser `<chord/>`; serialize/parse `part.ties`, articulations,
  annotations, tempo; voices > 2. Parts of unequal measure length / measure-number alignment.

---

## Model & caching policy (locked)
- Main agent loop: `claude-opus-4-8` (best musical reasoning + edits). Adaptive thinking on.
- Analysis tools are DETERMINISTIC client functions — model-independent, so no mid-session model
  switch (which would blow the cache). Reserve `claude-haiku-4-5` ONLY for a future separate
  "explain/analyze-only" mode (its own request), not the edit loop.
- Caching: tools + frozen system prompt form the stable prefix (cache_control on last system block);
  Score JSON + selection + user turn are volatile and come after. Verify `cache_read_input_tokens`.

## Verification per phase
- P1: a prompt round-trips; `usage.cache_read_input_tokens` > 0 on the 2nd turn; Score JSON reaches the model.
- P1.5: `buildSoundingSchedule` unit-tested; playback sounds identical post-refactor; each analysis tool tested.
- P2: "add a C quarter in bar 1" stages a `placeNote` diff; Approve inserts it; "fill bar 1 with sixteenths
  then one more" hits `measure_full` and Claude adapts; multi-step edit works; manual editing untouched.
- P3: AI-written articulations/time-sigs play back correctly.

## BUILD STATUS — all phases landed (2026-06-29)
Typecheck 0 errors · build green · 23 vitest (16 commands + 7 ears) · zero new lint · app boots.
- P1: `api/claude.ts` rewritten to a stateless relay (model/system/messages/tools → full content blocks +
  stop_reason + usage). `src/lib/ai/serializeForAi.ts` (native Score JSON w/ ids, in user msg),
  `src/lib/ai/systemPrompt.ts` (frozen, cache_control on the system block). `src/types/api.ts` + `src/api/claude.ts`
  now block-aware. Deleted `useAiPanel.ts`, dead `COMMIT_AI_SUGGESTION` (actions + reducer).
- P1.5: `src/lib/playback/schedule.ts::buildSoundingSchedule` extracted from playback.ts (parity refactor —
  playback now consumes it). `src/lib/ai/analysis.ts`: getSoundingTimeline/analyzeHarmony/findDissonances/
  checkVoiceLeading (deterministic). Tests in `src/lib/ai/ears.test.ts` (Cmaj=I, G7=V7, m2 flagged, MIDI/key resolution).
- P2: `src/lib/ai/tools.ts` (28 tool schemas = command vocab + 4 read tools), `src/lib/ai/executor.ts`
  (tool → commands.* → staged actions or typed rejection back to model), `src/hooks/useAiAgent.ts` (client loop;
  folds staged actions onto a working score via the reducer so multi-step + capacity stay correct; max 8 iters),
  `AiPromptBox` wired with explanation + staged-diff Approve/Reject; mounted in ScoreEditor with selection.
- P3: `schedule.ts` carries per-head articulations + per-measure dynamic→velocity; `playback.ts` applies
  staccato/spiccato clip (×0.5), fermata hold (×1.8), accent/marcato boost (×1.25), dynamic velocity.
  Default dynamic 1.0 preserves prior loudness. DEFERRED: true per-part polymeter (parts[0] still drives the
  barline grid — correct for shared time sig); MusicXML file fidelity (chords/ties/articulations/voices>2).

## LIVE TEST (needs user)
`/api/claude` is a Vercel function — plain `pnpm dev` (vite) does NOT serve it. To prompt for real:
deploy to Vercel, OR run `vercel dev`, with `ANTHROPIC_API_KEY` set (it's in `.env.local`). Then e.g.
"add a C major chord in bar 1" → staged diff → Approve. Manual editor parity unaffected.

## Accepted limitations (unchanged)
AI never writes GlyphOffset/TieCurveOverride/annotation anchors (auto-follow at render). Frozen tie-arch
won't re-avoid new collisions; annotations track measure not beat. Subjective musical taste stays human-in-loop.
