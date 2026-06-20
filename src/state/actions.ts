import type { Note, Rest, NoteEvent, TimeSig, KeySig, Clef, Tie, TieCurveOverride, Pitch, VoiceNumber } from '../types/score'

export type ScoreAction =
  | { type: 'ADD_NOTE'; partId: string; measureId: string; note: Note }
  | { type: 'ADD_REST'; partId: string; measureId: string; rest: Rest }
  | { type: 'REPLACE_REST'; partId: string; measureId: string; restId: string; note: Note }
  | { type: 'REPLACE_EVENT'; partId: string; measureId: string; eventId: string; event: NoteEvent }
  | { type: 'INSERT_EVENTS'; partId: string; measureId: string; index: number; events: NoteEvent[] }
  | { type: 'DELETE_NOTE'; partId: string; measureId: string; noteId: string }
  | { type: 'ADD_TIES'; partId: string; ties: Tie[] }
  | { type: 'REMOVE_TIE'; partId: string; tieId: string }
  | { type: 'UPDATE_TIE_CURVE'; partId: string; tieId: string; curve: Partial<TieCurveOverride> }
  // ax = glyph-center X relative to the notehead anchor (absolute; replaces). dy = vertical
  // drag delta (accumulates). Pins the glyph to its notehead so chord edits don't move it.
  | { type: 'UPDATE_GLYPH_OFFSET'; partId: string; measureId: string; noteId: string; pitchIndex: number; kind: 'accidental' | 'dot'; ax: number; dy: number }
  | { type: 'FILL_MEASURE_RESTS'; partId: string; measureId: string }
  | { type: 'APPLY_MEASURE_NOTES'; edits: { partId: string; measureId: string; notes: NoteEvent[] }[]; removedIds?: string[] }
  | { type: 'UPDATE_NOTE'; partId: string; measureId: string; noteId: string; patch: Partial<Note> }
  | { type: 'ADD_MEASURE'; partId: string }
  | { type: 'ADD_MEASURES'; count: number }
  | { type: 'DELETE_MEASURE'; partId: string; measureId: string }
  | { type: 'SET_TIME_SIG'; partId: string; measureId: string; timeSig: TimeSig }
  | { type: 'SET_KEY_SIG'; partId: string; measureId: string; keySig: KeySig }
  | { type: 'CLEAR_MEASURE_KEY_SIG'; measureNumber: number }
  | { type: 'CLEAR_MEASURE_TIME_SIG'; measureNumber: number }
  | { type: 'SET_GLOBAL_TIME_SIG'; timeSig: TimeSig }
  | { type: 'SET_GLOBAL_KEY_SIG'; keySig: KeySig }
  | { type: 'SET_SCORE_TIME_SIG_AT'; measureNumber: number; timeSig: TimeSig }
  | { type: 'SET_SCORE_KEY_SIG_AT'; measureNumber: number; keySig: KeySig }
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_MEASURE_TEMPO'; measureNumber: number; tempo: number }
  | { type: 'REMOVE_MEASURE_TEMPO'; measureNumber: number }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'ADD_PART'; name: string; instrument: string; clef: Clef }
  | { type: 'ADD_PIANO_PART' }
  | { type: 'REMOVE_PART'; partId: string }
  | { type: 'SET_PART_INSTRUMENT'; partId: string; instrument: string }
  | { type: 'ADD_CHORD_NOTE'; partId: string; measureId: string; noteId: string; pitch: Pitch }
  | { type: 'REMOVE_CHORD_NOTE'; partId: string; measureId: string; noteId: string; pitch: Pitch }
  // Group the selected contiguous events of one voice into a tuplet (e.g. played:3 / inSpaceOf:2
  // for a triplet). If every member already sits inside one existing tuplet, the new group nests
  // beneath it. memberIds are in document order.
  | { type: 'CREATE_TUPLET'; partId: string; measureId: string; memberIds: string[]; played: number; inSpaceOf: number }
  | { type: 'REMOVE_TUPLET'; partId: string; measureId: string; tupletId: string }
  // Entry-mode placement: drop a note/rest into a reserved tuplet of `played:inSpaceOf`. If the
  // cursor (atIndex, voice-local) sits inside an unfilled tuplet, fill its next slot(s); otherwise
  // reserve a fresh tuplet of `played` rests of the base unit (= duration/dots) at atIndex and fill
  // its first slot. A note longer than the base unit consumes that many whole slots. `pitches: null`
  // places a rest. `noteId` is the id given to the placed event so the caller can anchor the cursor.
  // `played`/`inSpaceOf`/`baseDuration`/`baseDots` come straight from the user-stated tuplet spec
  // and describe one reserved slot (e.g. 3 in the space of 2 eighths). `duration`/`dots` are the
  // placed event's own value (it may consume several base-unit slots, or split one). When
  // `targetRestId` is a reserved placeholder rest the placed event fills *that* slot (click
  // targeted a specific slot); otherwise a fresh tuplet is reserved at `atIndex` and its first
  // slot filled.
  | { type: 'PLACE_TUPLET_NOTE'; partId: string; measureId: string; voice: VoiceNumber; played: number; inSpaceOf: number; baseDuration: NoteEvent['duration']; baseDots: number; duration: NoteEvent['duration']; dots: number; pitches: Pitch[] | null; noteId: string; atIndex: number; targetRestId?: string }
  | { type: 'COMMIT_AI_SUGGESTION'; partId: string; measureNumbers: number[]; musicXML: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
