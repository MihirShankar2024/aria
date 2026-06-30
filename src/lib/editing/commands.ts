import type {
  Measure, Note, Rest, NoteEvent, Pitch, Duration, VoiceNumber,
  NoteArticulation, ArticulationType, Annotation, Tie, TimeSig, KeySig, Clef,
} from '../../types/score'
import type { ScoreAction } from '../../state/actions'
import { noteCanFit, effectiveTimeSigAt } from '../beats'
import { buildTie } from '../ties'
import type {
  CommandResult, Rejection, NewId, PartContext, PlaceNoteParams, PlaceRestParams,
} from './types'

const uuid: NewId = () => crypto.randomUUID()

// ── internal resolution helpers ─────────────────────────────────────────────

interface Located { measure: Measure; measureIndex: number }

function locate(ctx: PartContext, measureId: string): Located | Rejection {
  const measureIndex = ctx.measures.findIndex(m => m.id === measureId)
  if (measureIndex < 0) return { reason: 'not_found', what: 'measure', id: measureId }
  return { measure: ctx.measures[measureIndex], measureIndex }
}

function isRejection(x: Located | Rejection): x is Rejection {
  return 'reason' in x
}

function fail(rejection: Rejection): CommandResult {
  return { ok: false, rejection }
}

function timeSigAt(ctx: PartContext, loc: Located): TimeSig {
  return effectiveTimeSigAt(ctx.measures, loc.measureIndex, ctx.globalTimeSig)
}

// ── entry (voice-aware) ─────────────────────────────────────────────────────

/**
 * Place a note. Mirrors `StaffCanvas.placeAt`'s decision tree exactly:
 *  - anchor `near` a same-voice NOTE of identical duration+dots → add this tone to the chord
 *  - anchor `near` a same-voice NOTE of different rhythm → insert a new event after it (if it fits)
 *  - anchor `near` a same-voice REST → replace that rest
 *  - anchor `append` → append at end of the voice (if it fits)
 * Capacity is gated by `noteCanFit`; an overflow is rejected, never truncated. The caller must
 * resolve `near` against the target voice only (mirrors StaffCanvas:1283).
 */
export function placeNote(ctx: PartContext, p: PlaceNoteParams, newId: NewId = uuid): CommandResult {
  const loc = locate(ctx, p.measureId)
  if (isRejection(loc)) return fail(loc)
  const { measure } = loc

  // A `near` anchor whose target is in a DIFFERENT voice is not an anchor — it falls through to
  // append, starting an independent stack in `p.voice`. This mirrors StaffCanvas, whose
  // voice-filtered geometry never returns a cross-voice "near", and guards the AI from chording
  // across voices.
  if (p.anchor.kind === 'near') {
    const anchorId = p.anchor.eventId
    const target = measure.notes.find(n => n.id === anchorId)
    if (!target) return fail({ reason: 'not_found', what: 'event', id: anchorId })
    if (target.voice === p.voice) {

    if (target.type === 'note') {
      // Same rhythm in the same voice → chord. Different rhythm → distinct event after it.
      if (target.duration === p.duration && target.dots === p.dots) {
        return {
          ok: true, placedId: target.id,
          actions: [{
            type: 'ADD_CHORD_NOTE', partId: ctx.partId, measureId: measure.id,
            noteId: target.id, pitch: p.pitch,
            articulation: p.articulations?.[0]?.type,
          }],
        }
      }
      if (!noteCanFit(measure, { duration: p.duration, dots: p.dots }, timeSigAt(ctx, loc), p.voice)) {
        return fail({ reason: 'measure_full', measureId: measure.id, voice: p.voice })
      }
      const id = newId()
      const insertIdx = measure.notes.findIndex(n => n.id === target.id) + 1
      const note: Note = {
        id, type: 'note', pitches: [p.pitch], duration: p.duration, dots: p.dots,
        tied: false, voice: p.voice, articulations: p.articulations,
      }
      return {
        ok: true, placedId: id,
        actions: [{ type: 'INSERT_EVENTS', partId: ctx.partId, measureId: measure.id, index: insertIdx, events: [note] }],
      }
    }

    // target is a rest → replace it
    const id = newId()
    const note: Note = {
      id, type: 'note', pitches: [p.pitch], duration: p.duration, dots: p.dots,
      tied: false, voice: p.voice, articulations: p.articulations,
    }
    return {
      ok: true, placedId: id,
      actions: [{ type: 'REPLACE_REST', partId: ctx.partId, measureId: measure.id, restId: target.id, note }],
    }
    } // end same-voice target — cross-voice falls through to append
  }

  // append
  if (!noteCanFit(measure, { duration: p.duration, dots: p.dots }, timeSigAt(ctx, loc), p.voice)) {
    return fail({ reason: 'measure_full', measureId: measure.id, voice: p.voice })
  }
  const id = newId()
  const note: Note = {
    id, type: 'note', pitches: [p.pitch], duration: p.duration, dots: p.dots,
    tied: false, voice: p.voice, articulations: p.articulations,
  }
  return {
    ok: true, placedId: id,
    actions: [{ type: 'ADD_NOTE', partId: ctx.partId, measureId: measure.id, note }],
  }
}

/** Place a rest. Mirror of `placeNote`: `near` a same-voice note replaces it with a rest;
 *  `append` adds the rest at the end of the voice (if it fits). */
export function placeRest(ctx: PartContext, p: PlaceRestParams, newId: NewId = uuid): CommandResult {
  const loc = locate(ctx, p.measureId)
  if (isRejection(loc)) return fail(loc)
  const { measure } = loc

  // Cross-voice `near` falls through to append (mirrors placeNote / StaffCanvas geometry).
  if (p.anchor.kind === 'near') {
    const anchorId = p.anchor.eventId
    const target = measure.notes.find(n => n.id === anchorId)
    if (!target) return fail({ reason: 'not_found', what: 'event', id: anchorId })
    if (target.voice === p.voice) {
      const id = newId()
      const rest: Rest = { id, type: 'rest', duration: p.duration, dots: p.dots, voice: p.voice, articulations: p.articulations }
      return {
        ok: true, placedId: id,
        actions: [{ type: 'REPLACE_EVENT', partId: ctx.partId, measureId: measure.id, eventId: target.id, event: rest }],
      }
    }
  }

  if (!noteCanFit(measure, { duration: p.duration, dots: p.dots }, timeSigAt(ctx, loc), p.voice)) {
    return fail({ reason: 'measure_full', measureId: measure.id, voice: p.voice })
  }
  const id = newId()
  const rest: Rest = { id, type: 'rest', duration: p.duration, dots: p.dots, voice: p.voice, articulations: p.articulations }
  return {
    ok: true, placedId: id,
    actions: [{ type: 'ADD_REST', partId: ctx.partId, measureId: measure.id, rest }],
  }
}

/** Turn an existing event into a rest of the given duration. */
export function replaceWithRest(
  ctx: PartContext, measureId: string, eventId: string,
  duration: Duration, dots: 0 | 1, voice: VoiceNumber, newId: NewId = uuid,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const target = loc.measure.notes.find(n => n.id === eventId)
  if (!target) return fail({ reason: 'not_found', what: 'event', id: eventId })
  const id = newId()
  const rest: Rest = { id, type: 'rest', duration, dots, voice, articulations: target.articulations }
  return {
    ok: true, placedId: id,
    actions: [{ type: 'REPLACE_EVENT', partId: ctx.partId, measureId, eventId, event: rest }],
  }
}

// ── chords ──────────────────────────────────────────────────────────────────

/** Stack a pitch onto an existing note (make/extend a chord). Rejects an exact duplicate. */
export function addChordNote(
  ctx: PartContext, measureId: string, noteId: string,
  pitch: Pitch, articulation?: ArticulationType,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const target = loc.measure.notes.find(n => n.id === noteId)
  if (!target || target.type !== 'note') return fail({ reason: 'not_found', what: 'event', id: noteId })
  if (target.pitches.some(t => t.step === pitch.step && t.octave === pitch.octave && t.accidental === pitch.accidental)) {
    return fail({ reason: 'invalid_arg', detail: 'pitch already present in chord' })
  }
  return { ok: true, placedId: noteId, actions: [{ type: 'ADD_CHORD_NOTE', partId: ctx.partId, measureId, noteId, pitch, articulation }] }
}

/** Remove one pitch from a chord. Rejects removing the final tone (use deleteEvent instead). */
export function removeChordNote(
  ctx: PartContext, measureId: string, noteId: string, pitch: Pitch,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const target = loc.measure.notes.find(n => n.id === noteId)
  if (!target || target.type !== 'note') return fail({ reason: 'not_found', what: 'event', id: noteId })
  if (target.pitches.length <= 1) return fail({ reason: 'last_chord_note' })
  return { ok: true, actions: [{ type: 'REMOVE_CHORD_NOTE', partId: ctx.partId, measureId, noteId, pitch }] }
}

/** Delete an event outright. */
export function deleteEvent(ctx: PartContext, measureId: string, noteId: string): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  if (!loc.measure.notes.some(n => n.id === noteId)) return fail({ reason: 'not_found', what: 'event', id: noteId })
  return { ok: true, actions: [{ type: 'DELETE_NOTE', partId: ctx.partId, measureId, noteId }] }
}

// ── voice control ─────────────────────────────────────────────────────────

/** Move an existing event to the other voice, if the destination voice has room. */
export function setEventVoice(
  ctx: PartContext, measureId: string, eventId: string, toVoice: VoiceNumber,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const ev = loc.measure.notes.find(n => n.id === eventId)
  if (!ev) return fail({ reason: 'not_found', what: 'event', id: eventId })
  if (ev.voice === toVoice) return { ok: true, actions: [] }
  if (!noteCanFit(loc.measure, { duration: ev.duration, dots: ev.dots }, timeSigAt(ctx, loc), toVoice)) {
    return fail({ reason: 'measure_full', measureId, voice: toVoice })
  }
  return { ok: true, placedId: eventId, actions: [{ type: 'UPDATE_NOTE', partId: ctx.partId, measureId, noteId: eventId, patch: { voice: toVoice } as Partial<Note> }] }
}

/** Drop every event of a voice in a measure (collapse a polyphonic bar back toward monophony). */
export function clearVoice(ctx: PartContext, measureId: string, voice: VoiceNumber): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const actions: ScoreAction[] = loc.measure.notes
    .filter(n => n.voice === voice)
    .map(n => ({ type: 'DELETE_NOTE', partId: ctx.partId, measureId, noteId: n.id }))
  return { ok: true, actions }
}

/**
 * Enter a note (or rest, when `pitch` is null) into a reserved tuplet of `played:inSpaceOf`. The
 * geometry caller (StaffCanvas) resolves `atIndex`/`targetRestId` from a click; the AI supplies them
 * directly. Mirrors the `PLACE_TUPLET_NOTE` dispatch in StaffCanvas's tuplet-entry branch.
 */
export function placeTupletNote(
  ctx: PartContext,
  p: {
    measureId: string; voice: VoiceNumber
    played: number; inSpaceOf: number; baseDuration: Duration; baseDots: number
    duration: Duration; dots: 0 | 1; pitch: Pitch | null; atIndex: number; targetRestId?: string
    articulations?: NoteArticulation[]
  },
  newId: NewId = uuid,
): CommandResult {
  const loc = locate(ctx, p.measureId)
  if (isRejection(loc)) return fail(loc)
  if (p.played < 2 || p.inSpaceOf < 1) return fail({ reason: 'invalid_tuplet', detail: 'bad ratio' })
  const id = newId()
  return {
    ok: true, placedId: id,
    actions: [{
      type: 'PLACE_TUPLET_NOTE', partId: ctx.partId, measureId: p.measureId, voice: p.voice,
      played: p.played, inSpaceOf: p.inSpaceOf, baseDuration: p.baseDuration, baseDots: p.baseDots,
      duration: p.duration, dots: p.dots, pitches: p.pitch ? [p.pitch] : null, noteId: id,
      atIndex: p.atIndex, targetRestId: p.targetRestId, articulations: p.articulations,
    }],
  }
}

// ── connections & markings ─────────────────────────────────────────────────

/** Add a tie/slur span between two noteheads. `buildTie` normalises endpoint order and
 *  validates the heads exist; tie-vs-slur is derived later from whether pitches match. */
export function addSlurOrTie(
  ctx: PartContext, fromNoteId: string, fromPitchId: string, toNoteId: string, toPitchId: string,
): CommandResult {
  const tie: Tie | null = buildTie(ctx.measures, fromNoteId, fromPitchId, toNoteId, toPitchId)
  if (!tie) return fail({ reason: 'invalid_tie', detail: 'endpoints invalid or identical' })
  return { ok: true, placedId: tie.id, actions: [{ type: 'ADD_TIES', partId: ctx.partId, ties: [tie] }] }
}

export function removeTie(ctx: PartContext, tieId: string): CommandResult {
  return { ok: true, actions: [{ type: 'REMOVE_TIE', partId: ctx.partId, tieId }] }
}

/** Add or remove one articulation on an event. */
export function setArticulation(
  ctx: PartContext, measureId: string, noteId: string, artType: ArticulationType, on: boolean,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  const ev = loc.measure.notes.find(n => n.id === noteId)
  if (!ev) return fail({ reason: 'not_found', what: 'event', id: noteId })
  const current = ev.articulations ?? []
  const next: NoteArticulation[] = on
    ? (current.some(a => a.type === artType) ? current : [...current, { type: artType }])
    : current.filter(a => a.type !== artType)
  return { ok: true, placedId: noteId, actions: [{ type: 'UPDATE_NOTE', partId: ctx.partId, measureId, noteId, patch: { articulations: next } as Partial<Note> }] }
}

/** Add a pre-built free-floating marking (dynamic/ornament/hairpin/text). The caller builds the
 *  concrete `Annotation` (StaffCanvas via `buildAnnotation`; the AI via a builder added in Phase 2).
 *  Annotations anchor to a measure + pixel offset, not a beat — accepted limitation. */
export function addMarking(ctx: PartContext, annotation: Annotation): CommandResult {
  return { ok: true, placedId: annotation.id, actions: [{ type: 'ADD_ANNOTATION', partId: ctx.partId, annotation }] }
}

export function removeMarking(ctx: PartContext, id: string): CommandResult {
  return { ok: true, actions: [{ type: 'DELETE_ANNOTATION', partId: ctx.partId, id }] }
}

// ── tuplets ─────────────────────────────────────────────────────────────────

/** Group contiguous same-voice events into a tuplet. */
export function createTuplet(
  ctx: PartContext, measureId: string, memberIds: string[], played: number, inSpaceOf: number,
): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  if (memberIds.length < 1) return fail({ reason: 'invalid_tuplet', detail: 'no members' })
  const members = memberIds.map(id => loc.measure.notes.find(n => n.id === id))
  if (members.some(m => !m)) return fail({ reason: 'invalid_tuplet', detail: 'member not found' })
  const voices = new Set((members as NoteEvent[]).map(m => m.voice))
  if (voices.size > 1) return fail({ reason: 'invalid_tuplet', detail: 'members span multiple voices' })
  if (played < 2 || inSpaceOf < 1) return fail({ reason: 'invalid_tuplet', detail: 'bad ratio' })
  return { ok: true, actions: [{ type: 'CREATE_TUPLET', partId: ctx.partId, measureId, memberIds, played, inSpaceOf }] }
}

export function removeTuplet(ctx: PartContext, measureId: string, tupletId: string): CommandResult {
  const loc = locate(ctx, measureId)
  if (isRejection(loc)) return fail(loc)
  return { ok: true, actions: [{ type: 'REMOVE_TUPLET', partId: ctx.partId, measureId, tupletId }] }
}

// ── structure & globals (standalone wrappers, 1:1 with actions) ─────────────

export function addMeasures(count: number): CommandResult {
  if (count < 1) return fail({ reason: 'invalid_arg', detail: 'count < 1' })
  return { ok: true, actions: [{ type: 'ADD_MEASURES', count }] }
}

export function insertMeasures(count: number, at: number): CommandResult {
  if (count < 1) return fail({ reason: 'invalid_arg', detail: 'count < 1' })
  return { ok: true, actions: [{ type: 'INSERT_MEASURES', count, at }] }
}

export function removeMeasures(start: number, end: number): CommandResult {
  if (end < start) return fail({ reason: 'invalid_arg', detail: 'end < start' })
  return { ok: true, actions: [{ type: 'REMOVE_MEASURES', start, end }] }
}

export function setTimeSig(timeSig: TimeSig, at?: number): CommandResult {
  if (timeSig.beats < 1 || timeSig.beatType < 1) return fail({ reason: 'invalid_arg', detail: 'bad time signature' })
  return at == null
    ? { ok: true, actions: [{ type: 'SET_GLOBAL_TIME_SIG', timeSig }] }
    : { ok: true, actions: [{ type: 'SET_SCORE_TIME_SIG_AT', measureNumber: at, timeSig }] }
}

export function setKeySig(keySig: KeySig, at?: number): CommandResult {
  if (keySig.fifths < -7 || keySig.fifths > 7) return fail({ reason: 'invalid_arg', detail: 'fifths out of range' })
  return at == null
    ? { ok: true, actions: [{ type: 'SET_GLOBAL_KEY_SIG', keySig }] }
    : { ok: true, actions: [{ type: 'SET_SCORE_KEY_SIG_AT', measureNumber: at, keySig }] }
}

export function setTempo(tempo: number, at?: number): CommandResult {
  if (tempo <= 0) return fail({ reason: 'invalid_arg', detail: 'tempo <= 0' })
  return at == null
    ? { ok: true, actions: [{ type: 'SET_TEMPO', tempo }] }
    : { ok: true, actions: [{ type: 'SET_MEASURE_TEMPO', measureNumber: at, tempo }] }
}

export function setTitle(title: string): CommandResult {
  return { ok: true, actions: [{ type: 'SET_TITLE', title }] }
}

export function addPart(name: string, instrument: string, clef: Clef): CommandResult {
  return { ok: true, actions: [{ type: 'ADD_PART', name, instrument, clef }] }
}

export function addPianoPart(): CommandResult {
  return { ok: true, actions: [{ type: 'ADD_PIANO_PART' }] }
}

export function setPartInstrument(partId: string, instrument: string): CommandResult {
  return { ok: true, actions: [{ type: 'SET_PART_INSTRUMENT', partId, instrument }] }
}
