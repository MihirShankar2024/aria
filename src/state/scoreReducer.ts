import { produce } from 'immer'
import type { Score, Part, Measure, TimeSig, Pitch, NoteEvent, VoiceNumber } from '../types/score'
import type { ScoreAction } from './actions'
import { normalizeMeasureRests, fillMeasureWithRests } from '../lib/rests'
import { measureBeatCount, measureCapacity, noteBeatDuration, effectiveTimeSigAt } from '../lib/beats'
import { INSTRUMENT_DB } from '../lib/instruments'

const VOICES: readonly VoiceNumber[] = [1, 2]

function createDefaultMeasure(number: number): Measure {
  return { id: crypto.randomUUID(), number, notes: [] }
}

// Build the measure list for a brand-new part so it stays barline-aligned AND inherits
// the universal time/key-signature overrides already placed mid-score. Time sig and key
// sig live per-measure per-part (applied to every part via SET_SCORE_*_AT), so a fresh
// part built from blank measures would silently miss any change after measure 1 and break
// the "signatures are universal" invariant. We copy each override from a reference part
// (the first existing part — all parts share the same overrides) keyed by measure number.
// Tempo is already score-level (tempoChanges), so it needs no copying here.
function createInheritedMeasures(score: Score, count: number): Measure[] {
  const reference = score.parts[0]
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1
    const measure = createDefaultMeasure(number)
    const ref = reference?.measures.find(m => m.number === number)
    if (ref?.timeSig) measure.timeSig = ref.timeSig
    if (ref?.keySig) measure.keySig = ref.keySig
    return measure
  })
}

// Rest canonicalization walks a single linear timeline, so it must run per voice —
// otherwise it would merge/mis-group rests from two interleaved voices. Each voice's
// events are normalized independently and the result is re-stamped with its voice
// (rests created inside `normalizeMeasureRests` default to voice 1). The flat array
// comes back grouped voice-1-then-voice-2; renderer/ties don't depend on cross-voice
// order, and within-voice order is preserved.
function normalizeByVoice(notes: NoteEvent[], ts: TimeSig): NoteEvent[] {
  const out: NoteEvent[] = []
  for (const v of VOICES) {
    const ofVoice = notes.filter(n => n.voice === v)
    if (ofVoice.length === 0) continue
    for (const ev of normalizeMeasureRests(ofVoice, ts)) {
      out.push(ev.voice === v ? ev : { ...ev, voice: v })
    }
  }
  return out
}

// Pad each occupied voice's trailing gap with rests (the tool a user runs to complete
// a red voice). An empty measure fills voice 1.
function fillByVoice(notes: NoteEvent[], ts: TimeSig): NoteEvent[] {
  const occupied = VOICES.filter(v => notes.some(n => n.voice === v))
  const targets = occupied.length ? occupied : [1 as VoiceNumber]
  const out: NoteEvent[] = []
  for (const v of targets) {
    const ofVoice = notes.filter(n => n.voice === v)
    for (const ev of fillMeasureWithRests(ofVoice, ts)) {
      out.push(ev.voice === v ? ev : { ...ev, voice: v })
    }
  }
  return out
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

// Head identity key for a tie endpoint: event id + stable Pitch.id.
const headKey = (noteId: string, pitchId: string) => `${noteId}|${pitchId}`

// Drop ties whose endpoint notehead no longer exists (note or specific pitch removed).
// Run after any mutation that can delete a note or a chord tone.
function pruneUnresolvedTies(part: Part): void {
  if (!part.ties || part.ties.length === 0) return
  const heads = new Set<string>()
  for (const m of part.measures)
    for (const ev of m.notes)
      if (ev.type === 'note') for (const p of ev.pitches) heads.add(headKey(ev.id, p.id))
  part.ties = part.ties.filter(t => heads.has(headKey(t.from.note, t.from.pitch)) && heads.has(headKey(t.to.note, t.to.pitch)))
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
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'ADD_REST': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes.push(action.rest)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
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
          // Reject only if swapping in the (longer) note would overflow the rest's own voice.
          const newTotal = measureBeatCount(measure, rest.voice) - noteBeatDuration(rest) + noteBeatDuration(action.note)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            measure.notes[idx] = action.note
            measure.notes = normalizeByVoice(measure.notes, ts)
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
          // Reject only if the swapped-in event would overflow the old event's own voice.
          const newTotal = measureBeatCount(measure, old.voice) - noteBeatDuration(old) + noteBeatDuration(action.event)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            measure.notes[idx] = action.event
            measure.notes = normalizeByVoice(measure.notes, ts)
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
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'DELETE_NOTE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const measure = part?.measures.find(m => m.id === action.measureId)
        if (part && measure) {
          measure.notes = measure.notes.filter(n => n.id !== action.noteId)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
          // Drop ties whose endpoint was just removed (no note left to draw to).
          if (part.ties) {
            part.ties = part.ties.filter(t => t.from.note !== action.noteId && t.to.note !== action.noteId)
          }
        }
        break
      }
      case 'ADD_TIES': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part && action.ties.length > 0) {
          part.ties ??= []
          // Dedup by *directed slot*, not just by head: a new tie evicts an existing tie
          // only when it occupies the same role on the same head — its `from` head leaves
          // forward, or its `to` head arrives from behind. This still prevents two curves
          // leaving (or two entering) one head, while letting a single head carry one
          // incoming tie (as `to`) and one outgoing tie (as `from`) — the long-tie chain
          // A→B then B→C. Other heads of the same chord keep their ties, so multiple ties
          // may still fan out from one chord.
          const newFromHeads = new Set(action.ties.map(t => headKey(t.from.note, t.from.pitch)))
          const newToHeads   = new Set(action.ties.map(t => headKey(t.to.note, t.to.pitch)))
          part.ties = part.ties.filter(
            t => !newFromHeads.has(headKey(t.from.note, t.from.pitch)) && !newToHeads.has(headKey(t.to.note, t.to.pitch)),
          )
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
      case 'UPDATE_GLYPH_OFFSET': {
        const note = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
          ?.notes.find(n => n.id === action.noteId)
        if (note && note.type === 'note') {
          const pitch = note.pitches[action.pitchIndex]
          if (pitch) {
            const key = action.kind === 'accidental' ? 'accidentalOffset' : 'dotOffset'
            const prev = pitch[key]
            // X is anchored to the notehead (absolute), Y accumulates the drag delta.
            pitch[key] = { dx: action.ax, dy: (prev?.dy ?? 0) + action.dy }
          }
        }
        break
      }
      case 'APPLY_MEASURE_NOTES': {
        const touchedParts = new Set<string>()
        for (const edit of action.edits) {
          const measure = draft.parts
            .find(p => p.id === edit.partId)
            ?.measures.find(m => m.id === edit.measureId)
          if (measure) { measure.notes = edit.notes; touchedParts.add(edit.partId) }
        }
        // Drop ties whose endpoint notehead no longer exists — covers whole-note removal
        // and per-pitch deletion (a chord tone stripped while the note remains).
        for (const partId of touchedParts) {
          const part = draft.parts.find(p => p.id === partId)
          if (part) pruneUnresolvedTies(part)
        }
        break
      }
      case 'FILL_MEASURE_RESTS': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes = fillByVoice(measure.notes, effectiveTimeSig(draft, measure))
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
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
        }
        break
      }
      case 'ADD_CHORD_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId && n.type === 'note')
        if (note && note.type === 'note') {
          // A chord can't hold two noteheads on the same staff line/space, so reject any
          // pitch whose step+octave already occupies that position — whether an exact
          // duplicate (C♮ + C♮) or an enharmonic clash (C♮ + C♯, which is engraved as C + D♭).
          const occupied = note.pitches.some(
            p => p.step === action.pitch.step && p.octave === action.pitch.octave,
          )
          if (!occupied) {
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
            measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure))
          }
          // Drop ties on the removed head (whole note or just this chord tone).
          pruneUnresolvedTies(part)
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
      case 'ADD_MEASURES': {
        // Append `count` measures to every part so all tracks stay barline-aligned.
        const count = Math.max(1, Math.floor(action.count))
        for (const part of draft.parts) {
          let nextNum = (part.measures.at(-1)?.number ?? 0) + 1
          for (let i = 0; i < count; i++) part.measures.push(createDefaultMeasure(nextNum++))
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
            part.ties = part.ties.filter(t => !goneIds.has(t.from.note) && !goneIds.has(t.to.note))
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
      case 'CLEAR_MEASURE_KEY_SIG': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.keySig = undefined
        }
        break
      }
      case 'CLEAR_MEASURE_TIME_SIG': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.timeSig = undefined
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
          measures: createInheritedMeasures(draft, getMeasureCount(draft) || 4),
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
          measures: createInheritedMeasures(draft, count),
          grandStaffPartnerId: bassId,
        })
        draft.parts.push({
          id: bassId,
          name: 'Piano (Bass)',
          instrument: 'piano_bass',
          clef: 'bass',
          measures: createInheritedMeasures(draft, count),
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
  // A time-sig change propagates forward until the next change, so a measure without
  // its own override inherits from the most recent one in its part (else the global sig).
  for (const part of score.parts) {
    const idx = part.measures.indexOf(measure)
    if (idx !== -1) return effectiveTimeSigAt(part.measures, idx, score.globalTimeSig)
  }
  return measure.timeSig ?? score.globalTimeSig
}
