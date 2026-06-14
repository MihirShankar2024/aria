import { produce } from 'immer'
import type { Score, Part, Measure, TimeSig } from '../types/score'
import type { ScoreAction } from './actions'
import { normalizeMeasureRests, fillMeasureWithRests } from '../lib/rests'

function createDefaultMeasure(number: number): Measure {
  return { id: crypto.randomUUID(), number, notes: [] }
}

export function createDefaultScore(): Score {
  const trumpet: Part = {
    id: crypto.randomUUID(),
    name: 'Trumpet in Bb',
    instrument: 'trumpet_bb',
    clef: 'treble',
    measures: [createDefaultMeasure(1), createDefaultMeasure(2), createDefaultMeasure(3), createDefaultMeasure(4)],
  }
  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    tempo: 120,
    globalTimeSig: { beats: 4, beatType: 4 },
    globalKeySig: { fifths: 0, mode: 'major' },
    parts: [trumpet],
  }
}

export function scoreReducer(score: Score, action: ScoreAction): Score {
  return produce(score, draft => {
    switch (action.type) {
      case 'ADD_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes.push(action.note)
          measure.notes = normalizeMeasureRests(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'ADD_REST': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes.push(action.rest)
          measure.notes = normalizeMeasureRests(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'DELETE_NOTE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const measure = part?.measures.find(m => m.id === action.measureId)
        if (part && measure) {
          measure.notes = measure.notes.filter(n => n.id !== action.noteId)
          measure.notes = normalizeMeasureRests(measure.notes, effectiveTimeSig(draft, measure))
          // Drop ties whose endpoint was just removed (no note left to draw to).
          if (part.ties) {
            part.ties = part.ties.filter(t => t.from !== action.noteId && t.to !== action.noteId)
          }
        }
        break
      }
      case 'ADD_TIES': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part && action.ties.length > 0) {
          part.ties ??= []
          // A new span replaces any existing tie sharing an endpoint (avoids tangled overlaps).
          const endpoints = new Set(action.ties.flatMap(t => [t.from, t.to]))
          part.ties = part.ties.filter(t => !endpoints.has(t.from) && !endpoints.has(t.to))
          part.ties.push(...action.ties)
        }
        break
      }
      case 'REMOVE_TIE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part?.ties) part.ties = part.ties.filter(t => t.id !== action.tieId)
        break
      }
      case 'FILL_MEASURE_RESTS': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes = fillMeasureWithRests(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'UPDATE_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId)
        if (measure && note) {
          Object.assign(note, action.patch)
          measure.notes = normalizeMeasureRests(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'ADD_MEASURE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          const nextNum = (part.measures.at(-1)?.number ?? 0) + 1
          part.measures.push(createDefaultMeasure(nextNum))
        }
        break
      }
      case 'DELETE_MEASURE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          const removed = part.measures.find(m => m.id === action.measureId)
          part.measures = part.measures.filter(m => m.id !== action.measureId)
          if (removed && part.ties) {
            const goneIds = new Set(removed.notes.map(n => n.id))
            part.ties = part.ties.filter(t => !goneIds.has(t.from) && !goneIds.has(t.to))
          }
        }
        break
      }
      case 'SET_TIME_SIG': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) measure.timeSig = action.timeSig
        break
      }
      case 'SET_KEY_SIG': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) measure.keySig = action.keySig
        break
      }
      case 'SET_GLOBAL_TIME_SIG': {
        draft.globalTimeSig = action.timeSig
        break
      }
      case 'SET_GLOBAL_KEY_SIG': {
        draft.globalKeySig = action.keySig
        break
      }
      case 'SET_TEMPO': {
        draft.tempo = action.tempo
        break
      }
      case 'SET_TITLE': {
        draft.title = action.title
        break
      }
      case 'ADD_PART': {
        draft.parts.push({
          id: crypto.randomUUID(),
          name: action.name,
          instrument: action.instrument,
          clef: action.clef,
          measures: Array.from({ length: getMeasureCount(draft) || 4 }, (_, i) =>
            createDefaultMeasure(i + 1),
          ),
        })
        break
      }
      case 'REMOVE_PART': {
        draft.parts = draft.parts.filter(p => p.id !== action.partId)
        break
      }
      case 'SET_PART_INSTRUMENT': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) part.instrument = action.instrument
        break
      }
      // UNDO/REDO handled in useUndoRedo hook — no-op here
      case 'UNDO':
      case 'REDO':
      case 'COMMIT_AI_SUGGESTION':
        break
    }
  })
}

function getMeasureCount(score: Score): number {
  return Math.max(0, ...score.parts.map(p => p.measures.length))
}

function effectiveTimeSig(score: Score, measure: Measure): TimeSig {
  return measure.timeSig ?? score.globalTimeSig
}
