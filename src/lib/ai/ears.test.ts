import { describe, it, expect } from 'vitest'
import type { Score, Part, Measure, Note, Pitch, VoiceNumber, Duration } from '../../types/score'
import { buildSoundingSchedule } from '../playback/schedule'
import { analyzeHarmony, findDissonances, getSoundingTimeline, checkVoiceLeading } from './analysis'

let c = 0
const id = () => `id${c++}`
function pitch(step: Pitch['step'], octave: number, accidental: Pitch['accidental'] = null): Pitch {
  return { id: id(), step, octave, accidental }
}
function note(dur: Duration, voice: VoiceNumber, ...pitches: Pitch[]): Note {
  return { id: id(), type: 'note', pitches, duration: dur, dots: 0, tied: false, voice }
}
function measure(number: number, notes: Note[]): Measure {
  return { id: id(), number, notes }
}
function score(measures: Measure[], globalKeySig: Score['globalKeySig'] = { fifths: 0, mode: 'major' }): Score {
  const part: Part = { id: 'p1', name: 'Part', instrument: 'piano', clef: 'treble', measures, ties: [], annotations: [] }
  return { id: 's', title: 'T', tempo: 60, globalTimeSig: { beats: 4, beatType: 4 }, globalKeySig, parts: [part], tempoChanges: [] }
}

describe('buildSoundingSchedule', () => {
  it('resolves MIDI and onset times (C4 quarter at 60bpm = midi 60, 1s)', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('C', 4)), note('quarter', 1, pitch('D', 4))])])
    const { heads } = buildSoundingSchedule(s)
    expect(heads).toHaveLength(2)
    expect(heads[0].midi).toBe(60)
    expect(heads[0].noteName).toBe('C4')
    expect(heads[0].startSec).toBeCloseTo(0)
    expect(heads[1].midi).toBe(62)
    expect(heads[1].startSec).toBeCloseTo(1)   // after a quarter at 60bpm
  })

  it('applies key signature and accidentals to MIDI', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('F', 4, 'sharp'))])])
    const { heads } = buildSoundingSchedule(s)
    expect(heads[0].midi).toBe(66)   // F#4
  })
})

describe('analyzeHarmony', () => {
  it('identifies a C major triad as Cmaj / I in C major', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('C', 4), pitch('E', 4), pitch('G', 4))])])
    const { chords } = analyzeHarmony(s)
    expect(chords[0].chord).toBe('Cmaj')
    expect(chords[0].roman).toBe('I')
  })

  it('identifies a G dominant seventh as G7 / V7 in C major', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('G', 3), pitch('B', 3), pitch('D', 4), pitch('F', 4))])])
    const { chords } = analyzeHarmony(s)
    expect(chords[0].chord).toBe('G7')
    expect(chords[0].roman).toBe('V7')
  })

  it('uses minor-mode Roman numerals (A minor triad = i in A minor)', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('A', 3), pitch('C', 4), pitch('E', 4))])], { fifths: 0, mode: 'minor' })
    const { chords } = analyzeHarmony(s)
    expect(chords[0].chord).toBe('Amin')
    expect(chords[0].roman).toBe('i')      // lowercase, minor mode
  })

  it('reports inversion from the bass (C major triad with E in the bass = first inversion)', () => {
    // E below C/G → bass is E, the third → inversion 1
    const s = score([measure(1, [note('quarter', 1, pitch('E', 3), pitch('C', 4), pitch('G', 4))])])
    const { chords } = analyzeHarmony(s)
    expect(chords[0].chord).toBe('Cmaj')
    expect(chords[0].bass).toBe('E')
    expect(chords[0].inversion).toBe(1)
  })
})

describe('findDissonances', () => {
  it('flags a minor 2nd', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('C', 4), pitch('C', 4, 'sharp'))])])
    const { dissonances } = findDissonances(s)
    expect(dissonances.some(d => d.interval === 'minor 2nd')).toBe(true)
  })

  it('does not flag a consonant major triad', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('C', 4), pitch('E', 4), pitch('G', 4))])])
    const { dissonances } = findDissonances(s)
    expect(dissonances).toHaveLength(0)
  })
})

describe('checkVoiceLeading (per-part scoping)', () => {
  it('does NOT report a parallel fifth between two SEPARATE parts moving in parallel', () => {
    // part A: C4→D4, part B: G4→A4 (a fifth above, parallel). Pooled this looks like parallel
    // fifths; scoped per part each has a single voice line, so nothing should be flagged.
    const a: Part = { id: 'pA', name: 'A', instrument: 'piano', clef: 'treble', ties: [], annotations: [],
      measures: [measure(1, [note('quarter', 1, pitch('C', 4)), note('quarter', 1, pitch('D', 4))])] }
    const b: Part = { id: 'pB', name: 'B', instrument: 'piano', clef: 'treble', ties: [], annotations: [],
      measures: [measure(1, [note('quarter', 1, pitch('G', 4)), note('quarter', 1, pitch('A', 4))])] }
    const s: Score = { id: 's', title: 'T', tempo: 60, globalTimeSig: { beats: 4, beatType: 4 }, globalKeySig: { fifths: 0, mode: 'major' }, parts: [a, b], tempoChanges: [] }
    const { issues } = checkVoiceLeading(s)
    expect(issues.some(i => i.type === 'parallel_fifths')).toBe(false)
  })
})

describe('getSoundingTimeline', () => {
  it('returns sonorities sorted low-to-high with note ids', () => {
    const s = score([measure(1, [note('quarter', 1, pitch('E', 4), pitch('C', 4))])])
    const { sonorities } = getSoundingTimeline(s)
    expect(sonorities[0].pitches.map(p => p.note)).toEqual(['C4', 'E4'])
  })
})
