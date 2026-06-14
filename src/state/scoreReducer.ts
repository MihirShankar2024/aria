import { produce } from 'immer'
import type { Score, Part, Measure, TimeSig, Pitch } from '../types/score'
import type { ScoreAction } from './actions'
import { normalizeMeasureRests, fillMeasureWithRests } from '../lib/rests'
import { measureBeatCount, measureCapacity, noteBeatDuration } from '../lib/beats'
import { INSTRUMENT_DB } from '../lib/instruments'

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
    tempo: 100,
    globalTimeSig: { beats: 4, beatType: 4 },
    globalKeySig: { fifths: 0, mode: 'major' },
    parts: [trumpet],
    tempoChanges: [],
  }
}

// Compare two pitch arrays for equality (all elements must match).
function pitchArraysEqual(a: Pitch[], b: Pitch[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.step === b[i].step && p.octave === b[i].octave && p.accidental === b[i].accidental)
}

// Sort pitches low-to-high by (octave, step index).
const STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
function sortPitches(pitches: Pitch[]): Pitch[] {
  return [...pitches].sort((a, b) => {
    if (a.octave !== b.octave) return a.octave - b.octave
    return STEP_ORDER[a.step] - STEP_ORDER[b.step]
  })
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
      case 'REPLACE_REST': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const idx = measure?.notes.findIndex(n => n.id === action.restId && n.type === 'rest') ?? -1
        if (measure && idx !== -1) {
          const rest = measure.notes[idx]
          const ts = effectiveTimeSig(draft, measure)
          // Reject only if swapping in the (longer) note would overflow the measure.
          const newTotal = measureBeatCount(measure) - noteBeatDuration(rest) + noteBeatDuration(action.note)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            measure.notes[idx] = action.note
            measure.notes = normalizeMeasureRests(measure.notes, ts)
          }
        }
        break
      }
      case 'REPLACE_EVENT': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const idx = measure?.notes.findIndex(n => n.id === action.eventId) ?? -1
        if (measure && idx !== -1) {
          const old = measure.notes[idx]
          const ts = effectiveTimeSig(draft, measure)
          // Reject only if the swapped-in event would overflow the measure.
          const newTotal = measureBeatCount(measure) - noteBeatDuration(old) + noteBeatDuration(action.event)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            measure.notes[idx] = action.event
            measure.notes = normalizeMeasureRests(measure.notes, ts)
          }
        }
        break
      }
      case 'INSERT_EVENTS': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure && action.events.length > 0) {
          const at = Math.max(0, Math.min(action.index, measure.notes.length))
          measure.notes.splice(at, 0, ...action.events)
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
      case 'UPDATE_TIE_CURVE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const tie = part?.ties?.find(t => t.id === action.tieId)
        if (tie) tie.curve = { ...tie.curve, ...action.curve }
        break
      }
      case 'APPLY_MEASURE_NOTES': {
        for (const edit of action.edits) {
          const measure = draft.parts
            .find(p => p.id === edit.partId)
            ?.measures.find(m => m.id === edit.measureId)
          if (measure) measure.notes = edit.notes
        }
        // Drop ties whose endpoint note was removed.
        if (action.removedIds && action.removedIds.length > 0) {
          const removed = new Set(action.removedIds)
          for (const part of draft.parts) {
            if (part.ties) part.ties = part.ties.filter(t => !removed.has(t.from) && !removed.has(t.to))
          }
        }
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
      case 'ADD_CHORD_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId && n.type === 'note')
        if (note && note.type === 'note') {
          // Don't add duplicate pitches.
          const alreadyHas = note.pitches.some(
            p => p.step === action.pitch.step && p.octave === action.pitch.octave && p.accidental === action.pitch.accidental,
          )
          if (!alreadyHas) {
            note.pitches = sortPitches([...note.pitches, action.pitch])
          }
        }
        break
      }
      case 'REMOVE_CHORD_NOTE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const measure = part?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId && n.type === 'note')
        if (part && measure && note && note.type === 'note') {
          note.pitches = note.pitches.filter(
            p => !(p.step === action.pitch.step && p.octave === action.pitch.octave && p.accidental === action.pitch.accidental),
          )
          // If all pitches removed, delete the note entirely.
          if (note.pitches.length === 0) {
            measure.notes = measure.notes.filter(n => n.id !== action.noteId)
            measure.notes = normalizeMeasureRests(measure.notes, effectiveTimeSig(draft, measure))
            if (part.ties) {
              part.ties = part.ties.filter(t => t.from !== action.noteId && t.to !== action.noteId)
            }
          }
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
      case 'SET_SCORE_TIME_SIG_AT': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.timeSig = action.timeSig
        }
        break
      }
      case 'SET_SCORE_KEY_SIG_AT': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.keySig = action.keySig
        }
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
      case 'SET_MEASURE_TEMPO': {
        const existing = draft.tempoChanges.findIndex(tc => tc.measureNumber === action.measureNumber)
        if (existing !== -1) {
          draft.tempoChanges[existing].tempo = action.tempo
        } else {
          draft.tempoChanges.push({ measureNumber: action.measureNumber, tempo: action.tempo })
          draft.tempoChanges.sort((a, b) => a.measureNumber - b.measureNumber)
        }
        break
      }
      case 'REMOVE_MEASURE_TEMPO': {
        draft.tempoChanges = draft.tempoChanges.filter(tc => tc.measureNumber !== action.measureNumber)
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
      case 'ADD_PIANO_PART': {
        const trebleId = crypto.randomUUID()
        const bassId = crypto.randomUUID()
        const count = getMeasureCount(draft) || 4
        draft.parts.push({
          id: trebleId,
          name: 'Piano (Treble)',
          instrument: 'piano',
          clef: 'treble',
          measures: Array.from({ length: count }, (_, i) => createDefaultMeasure(i + 1)),
          grandStaffPartnerId: bassId,
        })
        draft.parts.push({
          id: bassId,
          name: 'Piano (Bass)',
          instrument: 'piano_bass',
          clef: 'bass',
          measures: Array.from({ length: count }, (_, i) => createDefaultMeasure(i + 1)),
          grandStaffPartnerId: trebleId,
        })
        break
      }
      case 'REMOVE_PART': {
        const part = draft.parts.find(p => p.id === action.partId)
        // If this is a grand staff part, also remove the partner.
        const partnerId = part?.grandStaffPartnerId
        draft.parts = draft.parts.filter(p => p.id !== action.partId && p.id !== partnerId)
        break
      }
      case 'SET_PART_INSTRUMENT': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          part.instrument = action.instrument
          part.name = INSTRUMENT_DB[action.instrument]?.displayName ?? action.instrument
        }
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

export { pitchArraysEqual }

function getMeasureCount(score: Score): number {
  return Math.max(0, ...score.parts.map(p => p.measures.length))
}

function effectiveTimeSig(score: Score, measure: Measure): TimeSig {
  return measure.timeSig ?? score.globalTimeSig
}
