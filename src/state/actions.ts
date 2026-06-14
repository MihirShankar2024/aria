import type { Note, Rest, TimeSig, KeySig, Clef, Tie } from '../types/score'

export type ScoreAction =
  | { type: 'ADD_NOTE'; partId: string; measureId: string; note: Note }
  | { type: 'ADD_REST'; partId: string; measureId: string; rest: Rest }
  | { type: 'DELETE_NOTE'; partId: string; measureId: string; noteId: string }
  | { type: 'ADD_TIES'; partId: string; ties: Tie[] }
  | { type: 'REMOVE_TIE'; partId: string; tieId: string }
  | { type: 'FILL_MEASURE_RESTS'; partId: string; measureId: string }
  | { type: 'UPDATE_NOTE'; partId: string; measureId: string; noteId: string; patch: Partial<Note> }
  | { type: 'ADD_MEASURE'; partId: string }
  | { type: 'DELETE_MEASURE'; partId: string; measureId: string }
  | { type: 'SET_TIME_SIG'; partId: string; measureId: string; timeSig: TimeSig }
  | { type: 'SET_KEY_SIG'; partId: string; measureId: string; keySig: KeySig }
  | { type: 'SET_GLOBAL_TIME_SIG'; timeSig: TimeSig }
  | { type: 'SET_GLOBAL_KEY_SIG'; keySig: KeySig }
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'ADD_PART'; name: string; instrument: string; clef: Clef }
  | { type: 'REMOVE_PART'; partId: string }
  | { type: 'SET_PART_INSTRUMENT'; partId: string; instrument: string }
  | { type: 'COMMIT_AI_SUGGESTION'; partId: string; measureNumbers: number[]; musicXML: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
