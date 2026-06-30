import type { Score, VoiceNumber } from '../../types/score'
import { buildSoundingSchedule, type ScheduledHead } from '../playback/schedule'
import { effectiveKeySig } from '../accidentals'

/**
 * Deterministic musical analysis over the sounding schedule — the AI's "ears". Every function
 * here is pure and computes facts from the resolved MIDI timeline (the SAME data the speakers
 * play), so the model reasons over reality instead of guessing. Objective issues (parallel
 * fifths/octaves, out-of-key notes, harsh dissonances) are reliable; subjective taste is not
 * decided here — that stays with the user.
 */

export interface MeasureRange { fromMeasure?: number; toMeasure?: number }

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const pc = (midi: number) => ((midi % 12) + 12) % 12
const pcName = (p: number) => PC_NAMES[p]

/** Tonic pitch class for a key signature, accounting for mode: minor uses the relative-minor tonic
 *  (3 semitones below the major tonic of the same signature — e.g. 0 sharps → A minor, not C). */
function tonicOf(fifths: number, mode: 'major' | 'minor'): number {
  const major = ((fifths * 7) % 12 + 12) % 12
  return mode === 'minor' ? (major + 9) % 12 : major
}

function inRange(h: ScheduledHead, r?: MeasureRange): boolean {
  if (!r) return true
  if (r.fromMeasure != null && h.measureNumber < r.fromMeasure) return false
  if (r.toMeasure != null && h.measureNumber > r.toMeasure) return false
  return true
}

/** Group heads into vertical sonorities at each distinct onset: every head sounding at that instant. */
interface Sonority { startSec: number; measureNumber: number; heads: ScheduledHead[] }
function sonorities(heads: ScheduledHead[]): Sonority[] {
  const onsets = [...new Set(heads.map(h => Math.round(h.startSec * 1000)))].sort((a, b) => a - b)
  const out: Sonority[] = []
  for (const ms of onsets) {
    const t = ms / 1000
    const sounding = heads.filter(h => h.startSec <= t + 1e-6 && h.startSec + h.durSec > t + 1e-6)
    if (sounding.length === 0) continue
    out.push({ startSec: t, measureNumber: Math.min(...sounding.map(h => h.measureNumber)), heads: sounding })
  }
  return out
}

// ── getSoundingTimeline ──────────────────────────────────────────────────────

export function getSoundingTimeline(score: Score, range?: MeasureRange) {
  const heads = buildSoundingSchedule(score).heads.filter(h => inRange(h, range))
  const son = sonorities(heads)
  return {
    sonorities: son.map(s => ({
      measure: s.measureNumber,
      timeSec: Number(s.startSec.toFixed(3)),
      pitches: [...s.heads].sort((a, b) => a.midi - b.midi).map(h => ({ note: h.noteName, midi: h.midi, voice: h.voice, noteId: h.noteId })),
    })),
    voices: voiceLines(heads),
  }
}

// Voice lines are scoped per PART+voice — a "voice 1" in part A is a different line from "voice 1"
// in part B. Pooling them (the old bug) produced phantom melodic lines and false leaps/parallels.
function voiceLines(heads: ScheduledHead[]) {
  const byKey = new Map<string, { partId: string; voice: VoiceNumber; hs: ScheduledHead[] }>()
  for (const h of heads) {
    const key = `${h.partId}:${h.voice}`
    const e = byKey.get(key) ?? { partId: h.partId, voice: h.voice, hs: [] }
    e.hs.push(h); byKey.set(key, e)
  }
  return [...byKey.values()].map(({ partId, voice, hs }) => ({
    partId, voice,
    line: hs.sort((a, b) => a.startSec - b.startSec).map(h => ({ note: h.noteName, midi: h.midi, measure: h.measureNumber })),
  }))
}

// ── chord identification ──────────────────────────────────────────────────────

const CHORD_TEMPLATES: { quality: string; intervals: number[] }[] = [
  { quality: 'maj', intervals: [0, 4, 7] },
  { quality: 'min', intervals: [0, 3, 7] },
  { quality: 'dim', intervals: [0, 3, 6] },
  { quality: 'aug', intervals: [0, 4, 8] },
  { quality: 'maj7', intervals: [0, 4, 7, 11] },
  { quality: '7', intervals: [0, 4, 7, 10] },
  { quality: 'min7', intervals: [0, 3, 7, 10] },
  { quality: 'dim7', intervals: [0, 3, 6, 9] },
  { quality: 'm7b5', intervals: [0, 3, 6, 10] },
]

interface ChordId { rootPc: number; quality: string; chordTones: Set<number>; score: number }
function identifyChord(pcs: Set<number>): ChordId | null {
  if (pcs.size < 2) return null
  let best: ChordId | null = null
  for (const root of pcs) {
    for (const tpl of CHORD_TEMPLATES) {
      const tones = new Set(tpl.intervals.map(i => (root + i) % 12))
      // require the full template present; reward fewer extras (non-chord tones).
      let matched = 0
      for (const tone of tones) if (pcs.has(tone)) matched++
      if (matched < tpl.intervals.length) continue
      const extras = [...pcs].filter(p => !tones.has(p)).length
      const sc = matched * 2 - extras
      if (!best || sc > best.score) best = { rootPc: root, quality: tpl.quality, chordTones: tones, score: sc }
    }
  }
  return best
}

const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11]    // semitone offsets of major scale degrees 1..7
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10]    // natural minor
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
function scaleFor(mode: 'major' | 'minor') { return mode === 'minor' ? MINOR_DEGREES : MAJOR_DEGREES }

function romanNumeral(rootPc: number, tonicPc: number, quality: string, mode: 'major' | 'minor'): string {
  const interval = ((rootPc - tonicPc) % 12 + 12) % 12
  const degIdx = scaleFor(mode).indexOf(interval)
  const base = degIdx >= 0 ? ROMAN[degIdx] : pcName(rootPc)   // non-diatonic (secondary/borrowed) → spell the pc
  const minorish = quality.startsWith('min') || quality.startsWith('dim') || quality === 'm7b5'
  let r = minorish ? base.toLowerCase() : base
  if (quality === 'dim' || quality === 'dim7' || quality === 'm7b5') r += '°'
  if (quality.includes('7')) r += '7'
  return r
}

// ── analyzeHarmony ────────────────────────────────────────────────────────────

export function analyzeHarmony(score: Score, range?: MeasureRange) {
  const heads = buildSoundingSchedule(score).heads.filter(h => inRange(h, range))
  const son = sonorities(heads)
  // tonic pitch class from the global key (fifths → tonic); good enough for diatonic labelling.
  const measures = score.parts[0]?.measures ?? []
  return {
    chords: son.map(s => {
      const pcs = new Set(s.heads.map(h => pc(h.midi)))
      const chord = identifyChord(pcs)
      const mIdx = measures.findIndex(m => m.number === s.measureNumber)
      const key = effectiveKeySig(measures, Math.max(0, mIdx), score.globalKeySig)
      const tonicPc = tonicOf(key.fifths, key.mode)
      const nonChordTones = chord ? [...pcs].filter(p => !chord.chordTones.has(p)).map(pcName) : []
      // Inversion from the lowest sounding pitch (the bass), relative to the root.
      const bassPc = pc(Math.min(...s.heads.map(h => h.midi)))
      const inversion = chord ? (((bassPc - chord.rootPc) % 12 + 12) % 12 === 0 ? 0
        : [...chord.chordTones].sort((a, b) => ((a - chord.rootPc + 12) % 12) - ((b - chord.rootPc + 12) % 12)).indexOf(bassPc)) : null
      return {
        measure: s.measureNumber,
        timeSec: Number(s.startSec.toFixed(3)),
        pitches: [...pcs].sort((a, b) => a - b).map(pcName),
        chord: chord ? `${pcName(chord.rootPc)}${chord.quality}` : null,
        roman: chord ? romanNumeral(chord.rootPc, tonicPc, chord.quality, key.mode) : null,
        bass: pcName(bassPc),
        inversion,
        nonChordTones,
      }
    }),
  }
}

// ── findDissonances ───────────────────────────────────────────────────────────

const DISSONANT: Record<number, string> = { 1: 'minor 2nd', 11: 'major 7th', 6: 'tritone', 2: 'major 2nd' }
export function findDissonances(score: Score, range?: MeasureRange) {
  const heads = buildSoundingSchedule(score).heads.filter(h => inRange(h, range))
  const son = sonorities(heads)
  const findings: { measure: number; interval: string; between: { note: string; noteId: string }[] }[] = []
  for (const s of son) {
    for (let i = 0; i < s.heads.length; i++) {
      for (let j = i + 1; j < s.heads.length; j++) {
        const iv = Math.abs(s.heads[i].midi - s.heads[j].midi) % 12
        const label = DISSONANT[iv]
        if (label && (iv === 1 || iv === 11 || iv === 6)) {   // report the harsh ones; M2 omitted as mild
          findings.push({
            measure: s.measureNumber, interval: label,
            between: [s.heads[i], s.heads[j]].map(h => ({ note: h.noteName, noteId: h.noteId })),
          })
        }
      }
    }
  }
  return { dissonances: findings }
}

// ── checkVoiceLeading ─────────────────────────────────────────────────────────

export function checkVoiceLeading(score: Score, range?: MeasureRange) {
  const heads = buildSoundingSchedule(score).heads.filter(h => inRange(h, range))
  const issues: { type: string; measure: number; detail: string }[] = []

  // Parallel 5ths/8ves and leaps are PER PART (a voice in one part is not a voice in another).
  const partIds = [...new Set(heads.map(h => h.partId))]
  for (const partId of partIds) {
    const son = sonorities(heads.filter(h => h.partId === partId))
    for (let k = 1; k < son.length; k++) {
      const prev = son[k - 1].heads, cur = son[k].heads
      for (let i = 0; i < prev.length; i++) for (let j = i + 1; j < prev.length; j++) {
        const a = prev[i], b = prev[j]
        const ivPrev = Math.abs(a.midi - b.midi) % 12
        if (ivPrev !== 7 && ivPrev !== 0) continue
        const a2 = cur.find(h => h.voice === a.voice)
        const b2 = cur.find(h => h.voice === b.voice)
        if (!a2 || !b2) continue
        const ivCur = Math.abs(a2.midi - b2.midi) % 12
        const moved = a2.midi !== a.midi || b2.midi !== b.midi
        if (ivCur === ivPrev && moved) {
          issues.push({ type: ivPrev === 7 ? 'parallel_fifths' : 'parallel_octaves', measure: son[k].measureNumber, detail: `${a.noteName}/${b.noteName} → ${a2.noteName}/${b2.noteName}` })
        }
      }
    }
  }

  // Large melodic leaps (> an octave) within each part+voice line.
  for (const { voice, line } of voiceLines(heads)) {
    for (let i = 1; i < line.length; i++) {
      const leap = Math.abs(line[i].midi - line[i - 1].midi)
      if (leap > 12) issues.push({ type: 'large_leap', measure: line[i].measure, detail: `voice ${voice}: ${line[i - 1].note} → ${line[i].note} (${leap} semitones)` })
    }
  }

  // Out-of-key sounding pitches vs the effective key (mode-aware).
  const measures = score.parts[0]?.measures ?? []
  for (const h of heads) {
    const mIdx = measures.findIndex(m => m.number === h.measureNumber)
    const key = effectiveKeySig(measures, Math.max(0, mIdx), score.globalKeySig)
    const tonicPc = tonicOf(key.fifths, key.mode)
    const scalePcs = new Set(scaleFor(key.mode).map(d => (tonicPc + d) % 12))
    if (!scalePcs.has(pc(h.midi))) issues.push({ type: 'out_of_key', measure: h.measureNumber, detail: `${h.noteName} is outside the key` })
  }

  return { issues }
}
