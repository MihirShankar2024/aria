# Phase 0 — Implementation Plan: Shared Editing-Intent Layer

Goal: extract the editing **intent** logic into a pure/headless module (`src/lib/editing/`)
that both the manual editor (`StaffCanvas.tsx`) and the future AI executor call. Proof of
fidelity: after refactor, manual editing behaves byte-identically.

## The core boundary (read this first)

`placeAt(x, y, forceNew, altKey)` in StaffCanvas does two jobs:

1. **Geometry resolution** (pixels → semantics): `getMeasureIndexAtX`, `staffYToPitch`,
   `nearestNoteAtX`, `nearestRestAtX`, `noteHeadAt`, `toConcert`. "Where did the user click,
   what pitch, near which event?"
2. **Intent → actions** (semantics → `ScoreAction[]`): same-voice chord vs insert vs
   replace-rest vs append, gated by `noteCanFit`.

Job #1 is inherently pixel/DOM — it **stays in StaffCanvas**. Job #2 is what the AI also needs
and is what moves to `commands.ts`. The commands layer operates on **semantic targets**
(partId, measureId, `Pitch`, voice, duration, dots, optional anchor eventId) — never pixels.

```
 StaffCanvas (mouse/keyboard)          AI executor (Phase 2)
   pixels --[geometry resolve]--> PlacementRequest <--[tool args]-- Claude
                                        |
                                  commands.placeNote(score, req)
                                        |
                              CommandResult { ok, actions[] } | { reject }
                                        |
                              dispatch(actions)  ----> scoreReducer (unchanged)
```

## File structure

- `src/lib/editing/types.ts` — `CommandResult`, `Rejection`, `PlacementAnchor`, per-command param types.
- `src/lib/editing/commands.ts` — pure functions. Import beats helpers + action types only. NO React, NO DOM, NO `crypto`-in-signature surprises (id generation injected — see below).
- `src/lib/editing/commands.test.ts` — unit tests (requires adding vitest; see Step 5).

### ID generation
`placeAt` calls `crypto.randomUUID()` inline. Pure functions must be deterministic-testable, so
commands take an optional `newId: () => string` (defaults to `crypto.randomUUID`). Tests inject a
counter; StaffCanvas/AI use the default.

## types.ts

```ts
export type Rejection =
  | { reason: 'measure_full'; measureId: string; voice: VoiceNumber }
  | { reason: 'not_found'; what: 'part' | 'measure' | 'event' }
  | { reason: 'invalid_tie'; detail: string }       // pitch mismatch / bad span
  | { reason: 'invalid_tuplet'; detail: string }
  | { reason: 'last_chord_note' }                    // can't remove final tone
  | { reason: 'invalid_arg'; detail: string }

export type CommandResult =
  | { ok: true; actions: ScoreAction[]; placedId?: string }
  | { ok: false; rejection: Rejection }

// Where to apply a placement, resolved by the caller (geometry for StaffCanvas, semantics for AI)
export type PlacementAnchor =
  | { kind: 'append' }                       // append at end of the voice in this measure
  | { kind: 'near'; eventId: string }        // chord-onto / insert-after / replace this event

export interface PlaceNoteParams {
  partId: string; measureId: string;
  pitch: Pitch;                              // CONCERT pitch (caller already did toConcert)
  duration: Duration; dots: 0 | 1;
  voice: VoiceNumber;
  anchor: PlacementAnchor;
  articulations?: NoteArticulation[];
}
// ...analogous param types for the rest
```

Helper inside commands.ts (not exported): `find(score, partId, measureId)` → `{ part, measure }`
or a `not_found` rejection.

## commands.ts — function set (each: `(score, params, newId?) => CommandResult`)

### Entry (voice-aware)
- `placeNote` — the decision tree, lifted verbatim from `placeAt`:
  - `anchor.kind==='near'` + target is a **note** of `params.voice`:
    - same `duration`&`dots` → `ADD_CHORD_NOTE`
    - else → `noteCanFit` ? `INSERT_EVENTS` after target : reject `measure_full`
  - `anchor.kind==='near'` + target is a **rest** of `params.voice` → `REPLACE_REST`
  - `anchor.kind==='append'` → `noteCanFit` ? `ADD_NOTE` : reject `measure_full`
  - proximity rule preserved: a near event of a *different* voice is treated as no anchor
    (caller already filters by voice when resolving `near`, mirroring StaffCanvas:1283).
- `placeRest` — mirror: `near` note → `REPLACE_EVENT`(rest); else `noteCanFit` ? `ADD_REST` : reject.
- `replaceWithRest(partId, measureId, eventId, duration, dots, voice)` → `REPLACE_EVENT`(rest).
- `addChordNote(partId, measureId, noteId, pitch, articulation?)` → `ADD_CHORD_NOTE`
  (reject `invalid_arg` if pitch already in chord).
- `removeChordNote(partId, measureId, noteId, pitch)` → `REMOVE_CHORD_NOTE`
  (reject `last_chord_note` if it's the only tone).
- `deleteEvent(partId, measureId, noteId)` → `DELETE_NOTE`.
- `placeTupletNote(...)` → `PLACE_TUPLET_NOTE` (carry the tuplet spec + atIndex + targetRestId
  fields exactly as the current dispatch does; geometry resolves atIndex/targetRestId).

### Voice control (new)
- `setEventVoice(partId, measureId, eventId, toVoice)` → `UPDATE_NOTE` patch `{ voice }`
  (reject `measure_full` if the destination voice can't hold it).
- `clearVoice(partId, measureId, voice)` → emit `DELETE_NOTE`s for every event of that voice
  (or `APPLY_MEASURE_NOTES` with voice filtered out — pick whichever the reducer normalizes cleanly).

### Connections & markings
- `addSlurOrTie(partId, fromEventId, toEventId)` → validate: tie requires equal pitch sets,
  contiguous; else `invalid_tie`. Returns `ADD_TIES`.
- `removeTie(partId, tieId)` → `REMOVE_TIE`.
- `setArticulation(partId, measureId, noteId, artType, on)` → `UPDATE_NOTE` patch of `articulations`.
- `addMarking({ partId, kind:'glyph'|'line'|'text', symbolId?|text?|lineType?, target })`
  — build the `Annotation` (glyph/line/text) and return `ADD_ANNOTATION`.
  `target` = `{ kind:'measure', measureId, dx?, dy? }` or `{ kind:'event', measureId, eventId }`
  (event resolved to `measureX + dx` at the event's x; **anchors to the measure, not the beat** —
  accepted limitation, see todo.md). Reuses the geometry already in `buildAnnotation`; the headless
  version takes a pre-resolved `dx,dy` so it stays pixel-free (StaffCanvas passes `x-g.x, y-STAVE_Y`).
- `removeMarking(partId, id)` → `DELETE_ANNOTATION`.
- `updateText(partId, id, text?, style?)` → `UPDATE_TEXT_ANNOTATION`.

### Structure & globals (thin wrappers — these are already 1:1 with actions)
- `createTuplet(partId, measureId, memberIds, played, inSpaceOf)` → validate members one voice,
  contiguous, divide cleanly; else `invalid_tuplet`. Returns `CREATE_TUPLET`.
- `removeTuplet`, `addMeasures`, `insertMeasures`, `removeMeasures`,
  `setTimeSig` (global / at measure), `setKeySig`, `setTempo` (global / per measure),
  `addPart`, `addPianoPart`, `setPartInstrument`, `setTitle`.
  These mostly just construct the existing action; the value is one validated entry point +
  uniform `CommandResult` so the AI executor handles them identically to the risky ones.

## Refactor steps (order matters — keep app green at each step)

1. **Add module, no callers.** Create `types.ts` + `commands.ts`. Move the body of the placement
   decision tree out of `placeAt` into `commands.placeNote`/`placeRest`/`replaceWithRest`.
   Leave `placeAt` calling the new commands.
2. **Rewrite `placeAt` as: geometry → PlacementRequest → command → dispatch.**
   - resolve `idx/measure`, `pitch = toConcert(staffYToPitch(...))`, and `anchor`:
     `nearestNoteAtX/​nearestRestAtX(x, …, targetVoice)` → `{kind:'near', eventId}`, else `{kind:'append'}`.
   - call `commands.placeNote(score, req)`; on `ok` dispatch each action + fire `onNotePlaced`,
     set `placementAppendedRef`/`pendingCenterRef` as today; on reject call `onPlaceFailed`.
   - tuplet-entry branch → `commands.placeTupletNote`; annotation branch → `commands.addMarking`.
   - **Leave the modifier-tool path** (`applyModifierToExistingNote`, dot/accidental glyph hit) in
     StaffCanvas for now — it's a pixel-aimed UI affordance; it can call `commands.setArticulation`
     for the articulation case but glyph-offset stays UI. (Out of Phase 0 scope: UPDATE_GLYPH_OFFSET.)
3. **Route the other dispatch sites** in StaffCanvas (chord add/remove, tie, tuplet create, voice)
   through the matching command so there's a single intent path. Keyboard handlers included
   (respect the register-once-effect ref pattern — see tasks/lessons.md).
4. **Grep for direct `dispatch({ type: 'ADD_NOTE' | 'REPLACE_REST' | ... })`** outside the reducer;
   each should now originate from a command. Toolbar/measure-level dispatches (SET_*) can call the
   thin command wrappers or stay direct — they carry no intent logic — but prefer the wrapper for AI parity.

## Step 5 — Verification

**Add vitest** (no test runner exists today): `pnpm add -D vitest`, add `"test": "vitest run"` to
package.json scripts, `vite.config.ts` already present.

Unit tests (`commands.test.ts`, pure — no DOM):
- placeNote append into empty 4/4 bar → `ADD_NOTE`.
- placeNote `near` same-voice same-duration note → `ADD_CHORD_NOTE`.
- placeNote `near` same-voice different-duration, fits → `INSERT_EVENTS` after; overflows → reject `measure_full`.
- placeNote `near` rest → `REPLACE_REST`.
- placeNote append overflow → reject `measure_full`.
- voice 2 placement near a voice-1 note with `anchor:append` → independent voice-2 event (no chord).
- addChordNote duplicate pitch → reject; removeChordNote last tone → reject `last_chord_note`.
- addSlurOrTie unequal pitches → reject `invalid_tie`.
- addMarking glyph(`dyn.sfz`) measure target → `ADD_ANNOTATION` with correct anchor.

**Manual parity (run the app):** in the editor, exercise — single note entry, chord (same
duration), insert (different duration), replace-rest, capacity reject (red flash), Alt → voice 2
independent stack, tuplet entry, dynamic drop. Each must behave exactly as on `main`.
Diff behavior against a stash of pre-refactor build if anything feels off.

## Out of scope for Phase 0 (deferred, on record)
- `UPDATE_GLYPH_OFFSET` / `UPDATE_ARTICULATION_OFFSET` / annotation move/stretch/scale — manual
  placement fields; AI never touches them; they stay pixel-UI in StaffCanvas.
- Beat-anchored annotations (AnnotationAnchor model change).
- Wiring AI read/write (Phases 1–2).
