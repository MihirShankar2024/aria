import type { Note, Rest, NoteEvent, TimeSig, KeySig, Clef, Tie, TieCurveOverride, Pitch } from '../types/score'

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
  | { type: 'COMMIT_AI_SUGGESTION'; partId: string; measureNumbers: number[]; musicXML: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
