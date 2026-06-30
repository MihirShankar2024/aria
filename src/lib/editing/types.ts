import type {
  Pitch, Duration, VoiceNumber, NoteArticulation, ArticulationType, Annotation,
  TextAnnotationStyle, TimeSig, KeySig, Clef, Measure,
} from '../../types/score'
import type { ScoreAction } from '../../state/actions'

/**
 * The slice of state a per-part command needs: the part's id, its measures, and the global
 * time signature (fallback for `effectiveTimeSigAt`). `StaffCanvas` builds this from its props;
 * the AI executor builds it from `score.parts[i]` + `score.globalTimeSig`. Keeping commands on
 * a part context (not the whole `Score`) matches how the editor already reasons — placement is
 * inherently per-part — and lets `StaffCanvas`, which never holds the full `Score`, call them.
 */
export interface PartContext {
  partId: string
  measures: Measure[]
  globalTimeSig: TimeSig
}

/**
 * Shared editing-intent layer (Phase 0). Pure, headless command functions that mirror the
 * user's editing intents and return the SAME `ScoreAction[]` a user's clicks produce — or a
 * typed rejection. Both the manual editor (`StaffCanvas`) and the AI executor call these, so
 * the AI provably "acts like a user": it cannot produce an edit a human couldn't, and an
 * illegal edit is rejected (not silently corrupting the score).
 *
 * The boundary: commands operate on SEMANTIC targets (partId, measureId, `Pitch`, voice,
 * duration). Pixel/DOM geometry (which measure was clicked, which pitch a Y maps to, which
 * event is nearest) is the caller's job — `StaffCanvas` resolves it from the mouse; the AI
 * supplies it from tool arguments.
 */

/** Why a command refused to produce actions. Surfaced to the AI in Phase 2. */
export type Rejection =
  | { reason: 'measure_full'; measureId: string; voice: VoiceNumber }
  | { reason: 'not_found'; what: 'part' | 'measure' | 'event'; id: string }
  | { reason: 'invalid_tie'; detail: string }
  | { reason: 'invalid_tuplet'; detail: string }
  | { reason: 'last_chord_note' }
  | { reason: 'invalid_arg'; detail: string }

export type CommandResult =
  | { ok: true; actions: ScoreAction[]; placedId?: string }
  | { ok: false; rejection: Rejection }

/** Injected id generator so commands stay deterministic-testable. Defaults to `crypto.randomUUID`. */
export type NewId = () => string

/**
 * Where to apply a placement, resolved by the caller. `near` means the caller found an existing
 * event (a notehead or rest the click landed on / the AI referenced) — the command decides
 * chord-onto vs insert-after vs replace-rest. `append` adds at the end of the voice in the bar.
 * The caller MUST resolve `near` against the target voice only (a near event of another voice is
 * not an anchor — mirrors `StaffCanvas` proximity rule).
 */
export type PlacementAnchor =
  | { kind: 'append' }
  | { kind: 'near'; eventId: string }

export interface PlaceNoteParams {
  measureId: string
  pitch: Pitch                  // CONCERT pitch (caller already applied any transposition)
  duration: Duration
  dots: 0 | 1
  voice: VoiceNumber
  anchor: PlacementAnchor
  articulations?: NoteArticulation[]
}

export interface PlaceRestParams {
  measureId: string
  duration: Duration
  dots: 0 | 1
  voice: VoiceNumber
  anchor: PlacementAnchor
  articulations?: NoteArticulation[]
}

/** Where a free-floating marking attaches. Both forms resolve to measure + pixel offset
 *  (annotations anchor to the measure, not a beat — accepted limitation). */
export type MarkingTarget =
  | { kind: 'measure'; measureId: string; dx: number; dy: number }

export type { Pitch, Duration, VoiceNumber, NoteArticulation, ArticulationType, Annotation, TextAnnotationStyle, TimeSig, KeySig, Clef, ScoreAction }
