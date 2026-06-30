# Phase 4 — Token efficiency + hardening (Opus 4.8)

Goal: cut tokens/cost-per-prompt hard while *improving* functionality. Lead with caching + payload
shape (structural wins), then correctness/UX, then analysis quality, then coverage.

## Coverage of the 7 next-steps (nothing dropped)
| # | Next-step from the recap | Workstream(s) | Priority |
|---|---|---|---|
| 1 | Batch-undo on approve | W2.1 | P0 |
| 2 | Conversation memory + send the cursor | W2.2, W2.3 | P1 |
| 3 | Verify/fix caching | W1.1 (+W1.5) | P0 |
| 4 | Harden the analysis (per-part, minor keys, inversions) | W3.1–W3.3 | P1 |
| 5 | `placeTupletNote` command | W4.1 | P2 |
| 6 | Handle refusal/max_tokens + streaming + adaptive thinking | W2.4 (stop reasons), W2.5 (streaming), Model policy (thinking) | P1 |
| 7 | Transposition awareness | W4.2 | P2 |
Plus token-efficiency work the recap implied but didn't number: W1.2 scoped score view, W1.3 compact
encoding, W1.4 fewer iterations, W4.3 marking catalog.

## Where the tokens go today (the model to optimize)
Per prompt the request body = `tools (28 schemas)` + `system` + `messages`. The loop re-POSTs the
WHOLE growing `messages` each iteration (up to 8). So cost ≈
  (tools+system) × iterations  +  scoreJSON × iterations  +  Σ(tool_results)  +  output.
- **tools+system**: fixed, sent every iteration. ~3–4k tokens. Currently `cache_control` is on the
  system block but the prefix may be under Opus 4.8's 4096-token cache minimum → likely NOT caching
  (check `usage.cache_read_input_tokens`; the hook exposes `cacheHit`).
- **scoreJSON**: the entire score, in `messages[0]`, re-sent every iteration of the prompt. Dominates
  cost on large scores. This is the #1 lever.
- **tool_results**: analysis tools over wide ranges can be large.

---

## W1 — Token efficiency core (P0; do first, biggest wins)

### W1.1 Real multi-breakpoint caching (intra-prompt is the guaranteed win)
- Put `cache_control: {type:'ephemeral'}` on (a) the last `system` block AND (b) a **rolling breakpoint
  on the last content block of the most recent message** each iteration. Max 4 breakpoints; use 2–3.
- Effect: within a prompt's tool loop, iterations 2..N read system+tools+scoreJSON+prior turns from
  cache (~0.1×) and pay full price only for the newly appended tool_results. `scoreJSON` is in
  `messages[0]` and never changes within a prompt, so it caches after iteration 1.
- Cross-prompt: tools+system cache persists IF that prefix ≥ 4096 tokens. If `cacheHit` shows it
  doesn't, either accept it or pad/reorder (see W1.3 — tool-search makes this moot).
- Verify: log `cacheHit`; expect >0 on iteration 2 of any multi-step prompt.

### W1.2 Scoped score view + on-demand fetch (biggest win on large scores)
- `scoreForAi` stops sending all bars. It sends:
  - a **structural index**: parts (id/name/clef), total measures, and a per-measure map of
    time/key/tempo CHANGES only (not every bar);
  - **full detail only for the focus window**: the selected measures ± N bars of context (default the
    selection, else the last-edited region, else bars 1–4).
- Add a read tool `getMeasures(partId?, fromMeasure, toMeasure)` so the model pulls detail on demand
  when a request reaches outside the window. System prompt teaches: "you see an index + a focus window;
  call getMeasures to inspect other bars before editing them."
- Trade-off: model could act without enough context → mitigated by the index + cheap fetch + the
  rejection-feedback safety net (a bad edit is rejected, not applied).

### W1.3 Compact encoding — omit defaults
- Drop fields when at their default: `dots:0`, `accidental:null`, `voice:1`, `tied:false`,
  empty articulations. Document the defaults in the system prompt. Most notes are voice-1/no-dot/
  natural → roughly halves per-note tokens. Optionally shorten keys (s/o/a for step/octave/accidental).
- Keep ids (needed for targeting) but consider short ids in the AI projection mapped back in the
  executor (stretch — only if profiling shows id bytes matter).

### W1.4 Fewer iterations + leaner tool_results
- System prompt: "emit independent edits as PARALLEL tool calls in one turn" (parallel tool use is on
  by default; the loop already returns all results in one message). A 3-note chord = one turn, not three.
- Cap analysis ranges (default to the focus window) and keep tool_result JSON terse.

### W1.5 Tool-search (P1, optional, evaluate after W1.1)
- If `cacheHit` shows tools+system isn't caching cross-prompt and the 28-tool block is a real cost,
  enable the server **tool-search** tool with the 28 tools marked `defer_loading: true`. The model
  loads only the handful it needs; schemas are appended (cache-preserving). Adds one discovery hop.
  Skip if caching already absorbs the tool cost.

---

## W2 — Correctness & UX (P0/P1; cheap, high feel)

### W2.1 Batch-undo on approve (P0)
- Add a `BATCH` action `{ type:'BATCH', actions: ScoreAction[] }` the reducer applies in order within
  one undo entry (the undo/redo wrapper treats it as a single present). Approve dispatches ONE BATCH
  → one Cmd-Z reverts the whole AI edit. ~small change in `useUndoRedo`/reducer.

### W2.2 Conversation memory across prompts (P1)
- Keep the message history in `useAiAgent` across `send` calls (don't reset). Re-send the (scoped)
  score each new user turn as a fresh user message, but retain prior assistant/explanation turns so
  "now make that louder" resolves. Cap/trim history (e.g. last 3 exchanges) for tokens. Add a "clear
  chat" affordance. Plays well with W1.1 caching (stable history prefix).

### W2.3 Send the cursor (P1)
- Extend `AiSelection` with the keyboard cursor (partId, measureNumber, beat/eventId) from ScoreEditor
  so "add a note here" resolves to a real anchor without a selection.

### W2.4 Robust stop_reasons (P1)
- Handle `stop_reason:'refusal'` (surface Claude's reason in the box) and `'max_tokens'` (tell the user
  the turn was cut off; offer continue). Today both silently produce an empty result.

### W2.5 Streaming (P2; latency + long-turn safety) — second half of next-step #6
Two tiers, ship the cheap one first:
- **Tier A (server-only, no client change):** the relay uses `client.messages.stream(...)` +
  `await stream.finalMessage()` instead of `.create`, returning the same final JSON. This prevents
  HTTP timeouts on long/thinking turns (adaptive thinking can make turns multi-minute) with zero
  client work. Do this when W-model-policy turns thinking on.
- **Tier B (progressive UI):** relay passes SSE through; client consumes `text_delta` (and
  `thinking_delta` if shown) to render Claude's explanation as it arrives, then assembles the final
  message to run the tool loop. The tool LOOP still needs complete `tool_use` blocks before executing,
  so streaming improves perceived latency + shows reasoning, not the edit-apply step. `AiPromptBox`
  shows a live-typing explanation + a "working…" state per iteration.
- Note: with caching (W1.1) the iteration round-trips are already cheap; streaming is UX, not a token
  win — keep it P2 unless turns feel slow.

---

## W3 — Analysis ("ears") hardening (P1; turns demo into useful)

### W3.1 Per-part scoping for voice-leading
- `checkVoiceLeading` currently pools heads across parts and groups by voice number 1/2 → wrong for
  multi-part. Scope voice-line tracking per `partId` (and per voice within a part). Harmony/dissonance
  may stay cross-part (vertical sonorities are legitimately cross-part).

### W3.2 Minor keys + inversions + non-diatonic romans
- Roman numerals: use the actual mode (major/minor scale degrees), spell secondary dominants/borrowed
  chords instead of falling back to a pitch-class name. Out-of-key check honors mode.
- Chord id: report inversion (bass = lowest sounding pc) and added/sus tones.

### W3.3 Tests
- Extend `ears.test.ts`: minor-key romans (i, V, iv°), an inversion, a per-part parallel-fifth case that
  must NOT false-positive across parts.

---

## W4 — Coverage gaps (P2)

### W4.1 `placeTupletNote` command + tool
- Lift the tuplet-entry path from StaffCanvas into `commands.placeTupletNote` (the Phase 0 deferral),
  expose a tool, so the AI can WRITE tuplet rhythms (not just group existing notes).

### W4.2 Transposition awareness
- Tell the model each part's transposition (or that pitches are concert) in the snapshot, and accept a
  `written` vs `concert` hint on placeNote for transposing instruments — convert via existing
  `writtenPitchToConcert`. Prevents "write a C for clarinet" surprises.

### W4.3 `addMarking` ergonomics
- Give the model a small enum/catalog of valid `symbolId`s (dynamics + common ornaments) in the system
  prompt or a `listMarkings` read tool, so it stops guessing ids that get rejected.

---

## Model policy (Opus, token-aware)
- Stay on `claude-opus-4-8`. Enable **adaptive thinking** (`thinking:{type:'adaptive'}`): the model
  self-moderates when to think, improving hard musical reasoning while keeping simple edits cheap.
  Cost: thinking blocks must be echoed back in the loop — absorbed by W1.1 caching. Re-evaluate if
  `effort` tuning is needed (default high is fine; drop to medium for cost).
- Analysis tools stay deterministic client functions (model-independent) — no mid-session model switch
  (would blow the cache).

## Recommended build order
1. W1.1 caching + W1.3 omit-defaults + W2.1 batch-undo  (cheap, immediate cost + UX wins)
2. W1.2 scoped score view + getMeasures  (the large-score win)
3. W2.2 memory + W2.3 cursor + W2.4 stop_reasons  (feel)
4. W3 analysis hardening  (usefulness)
5. W4 coverage + W1.5 tool-search if profiling still shows tool cost

## Verification per workstream
- W1: `cacheHit` > 0 on loop iteration 2; measure total input tokens before/after on a big score
  (target large reduction) via `usage`. Edits still correct.
- W2.1: AI multi-edit = single Cmd-Z. W2.2: follow-up "make it louder" works. W2.4: refusal shows a message.
- W3: new ears tests pass; no cross-part false positives. W4: AI writes a triplet; clarinet C lands as concert Bb.
