import { describe, it, expect } from 'vitest'
import type { Measure, Note, Rest, Pitch, TimeSig, VoiceNumber, Duration } from '../../types/score'
import type { PartContext } from './types'
import {
  placeNote, placeRest, addChordNote, removeChordNote, addSlurOrTie, setEventVoice,
} from './commands'

// ── fixtures ────────────────────────────────────────────────────────────────

const FOUR_FOUR: TimeSig = { beats: 4, beatType: 4 }
let counter = 0
const seq = () => `id-${counter++}`

function pitch(step: Pitch['step'], octave: number): Pitch {
  return { id: seq(), step, octave, accidental: null }
}
function note(dur: Duration, voice: VoiceNumber = 1, ...pitches: Pitch[]): Note {
  return { id: seq(), type: 'note', pitches: pitches.length ? pitches : [pitch('C', 4)], duration: dur, dots: 0, tied: false, voice }
}
function rest(dur: Duration, voice: VoiceNumber = 1): Rest {
  return { id: seq(), type: 'rest', duration: dur, dots: 0, voice }
}
function measure(notes: (Note | Rest)[]): Measure {
  return { id: seq(), number: 1, notes }
}
function ctxOf(...notes: (Note | Rest)[]): { ctx: PartContext; measure: Measure } {
  const m = measure(notes)
  return { ctx: { partId: 'p1', measures: [m], globalTimeSig: FOUR_FOUR }, measure: m }
}
const newId = () => 'NEW'
const C4 = () => pitch('C', 4)

// ── placeNote ────────────────────────────────────────────────────────────────

describe('placeNote', () => {
  it('appends into an empty bar → ADD_NOTE', () => {
    const { ctx, measure } = ctxOf()
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'append' } }, newId)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions).toEqual([{ type: 'ADD_NOTE', partId: 'p1', measureId: measure.id, note: expect.objectContaining({ id: 'NEW', type: 'note', duration: 'quarter', voice: 1 }) }])
  })

  it('near a same-voice note of identical rhythm → ADD_CHORD_NOTE', () => {
    const target = note('quarter')
    const { ctx, measure } = ctxOf(target)
    const r = placeNote(ctx, { measureId: measure.id, pitch: pitch('E', 4), duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'near', eventId: target.id } }, newId)
    expect(r.ok && r.actions[0].type).toBe('ADD_CHORD_NOTE')
  })

  it('near a same-voice note of different rhythm that fits → INSERT_EVENTS after it', () => {
    const target = note('quarter')
    const { ctx, measure } = ctxOf(target)
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'eighth', dots: 0, voice: 1, anchor: { kind: 'near', eventId: target.id } }, newId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].type).toBe('INSERT_EVENTS')
      if (r.actions[0].type === 'INSERT_EVENTS') expect(r.actions[0].index).toBe(1)
    }
  })

  it('near a different-rhythm note that overflows the bar → reject measure_full', () => {
    // bar already full: four quarters; an extra eighth (different rhythm → insert path) overflows
    const target = note('quarter')
    const { ctx, measure } = ctxOf(target, note('quarter'), note('quarter'), note('quarter'))
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'eighth', dots: 0, voice: 1, anchor: { kind: 'near', eventId: target.id } }, newId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('measure_full')
  })

  it('near a same-voice rest → REPLACE_REST', () => {
    const r0 = rest('quarter')
    const { ctx, measure } = ctxOf(r0)
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'near', eventId: r0.id } }, newId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].type).toBe('REPLACE_REST')
      if (r.actions[0].type === 'REPLACE_REST') expect(r.actions[0].restId).toBe(r0.id)
    }
  })

  it('append overflow → reject measure_full', () => {
    const { ctx, measure } = ctxOf(note('quarter'), note('quarter'), note('quarter'), note('quarter'))
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'append' } }, newId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('measure_full')
  })

  it('voice 2 anchored near a voice-1 note does NOT chord — falls through to an independent voice-2 append', () => {
    const v1 = note('quarter', 1)
    const { ctx, measure } = ctxOf(v1)
    const r = placeNote(ctx, { measureId: measure.id, pitch: C4(), duration: 'quarter', dots: 0, voice: 2, anchor: { kind: 'near', eventId: v1.id } }, newId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].type).toBe('ADD_NOTE')           // append, not chord
      if (r.actions[0].type === 'ADD_NOTE') expect(r.actions[0].note.voice).toBe(2)
    }
  })

  it('rejects an unknown measure', () => {
    const { ctx } = ctxOf()
    const r = placeNote(ctx, { measureId: 'nope', pitch: C4(), duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'append' } }, newId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('not_found')
  })
})

// ── placeRest ────────────────────────────────────────────────────────────────

describe('placeRest', () => {
  it('near a same-voice note → REPLACE_EVENT with a rest', () => {
    const n = note('quarter')
    const { ctx, measure } = ctxOf(n)
    const r = placeRest(ctx, { measureId: measure.id, duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'near', eventId: n.id } }, newId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].type).toBe('REPLACE_EVENT')
      if (r.actions[0].type === 'REPLACE_EVENT') expect(r.actions[0].event.type).toBe('rest')
    }
  })

  it('append into empty bar → ADD_REST', () => {
    const { ctx, measure } = ctxOf()
    const r = placeRest(ctx, { measureId: measure.id, duration: 'quarter', dots: 0, voice: 1, anchor: { kind: 'append' } }, newId)
    expect(r.ok && r.actions[0].type).toBe('ADD_REST')
  })
})

// ── chords ───────────────────────────────────────────────────────────────────

describe('chords', () => {
  it('addChordNote rejects a duplicate pitch', () => {
    const n = note('quarter', 1, pitch('C', 4))
    const { ctx, measure } = ctxOf(n)
    const r = addChordNote(ctx, measure.id, n.id, { id: 'x', step: 'C', octave: 4, accidental: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('invalid_arg')
  })

  it('removeChordNote rejects removing the final tone', () => {
    const only = pitch('C', 4)
    const n = note('quarter', 1, only)
    const { ctx, measure } = ctxOf(n)
    const r = removeChordNote(ctx, measure.id, n.id, only)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('last_chord_note')
  })
})

// ── ties ─────────────────────────────────────────────────────────────────────

describe('addSlurOrTie', () => {
  it('rejects identical endpoints', () => {
    const p = pitch('C', 4)
    const n = note('quarter', 1, p)
    const { ctx } = ctxOf(n)
    const r = addSlurOrTie(ctx, n.id, p.id, n.id, p.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('invalid_tie')
  })

  it('builds a tie between two real noteheads', () => {
    const p1 = pitch('C', 4); const p2 = pitch('C', 4)
    const n1 = note('quarter', 1, p1); const n2 = note('quarter', 1, p2)
    const { ctx } = ctxOf(n1, n2)
    const r = addSlurOrTie(ctx, n1.id, p1.id, n2.id, p2.id)
    expect(r.ok && r.actions[0].type).toBe('ADD_TIES')
  })
})

// ── voice control ─────────────────────────────────────────────────────────────

describe('setEventVoice', () => {
  it('moves an event to the other voice when it fits', () => {
    const n = note('quarter', 1)
    const { ctx, measure } = ctxOf(n)
    const r = setEventVoice(ctx, measure.id, n.id, 2)
    expect(r.ok).toBe(true)
    if (r.ok && r.actions[0].type === 'UPDATE_NOTE') expect(r.actions[0].patch).toEqual({ voice: 2 })
  })

  it('is a no-op when already in the target voice', () => {
    const n = note('quarter', 1)
    const { ctx, measure } = ctxOf(n)
    const r = setEventVoice(ctx, measure.id, n.id, 1)
    expect(r.ok && r.actions.length).toBe(0)
  })
})
