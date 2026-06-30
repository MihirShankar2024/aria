import type { Score, NoteEvent, Tuplet, VoiceNumber, ArticulationType } from '../../types/score'
import { effectiveTimeSigAt, eventBeats, measureCapacity } from '../beats'
import { resolvePartAccidentals } from '../accidentals'

const NOTE_MIDI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI → sharp-spelled scientific name (e.g. 60 → "C4", 61 → "C#4"). Matches Tone's default. */
export function midiToName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

/**
 * One sounding notehead: a single attack on the audio clock. This is the AI's "ears" AND the data
 * the speakers play — identical resolution. Tie chains are merged (the chain start carries the
 * summed duration; continuations are omitted), so each entry is a distinct sounding onset.
 */
export interface ScheduledHead {
  partId: string
  noteId: string
  pitchId: string
  voice: VoiceNumber
  midi: number
  noteName: string
  startSec: number     // absolute seconds from the start of the piece
  durSec: number       // NOTATED seconds (incl. tie-chain extension). Playback applies articulation
                       // shaping on top; analysis uses this notated value.
  measureNumber: number
  articulations: ArticulationType[]
  /** Per-part playback velocity baseline (0–1) from the most recent dynamic at/before this measure. */
  dynamic: number
}

export interface SoundingSchedule {
  heads: ScheduledHead[]
  totalSec: number     // barline-aligned length of the whole piece
}

function eventDurationSeconds(event: NoteEvent, tempo: number, tuplets?: Tuplet[]): number {
  return eventBeats(event, tuplets) * (60 / tempo)
}

function effectiveTempo(score: Score, measureNumber: number): number {
  let tempo = score.tempo
  for (const tc of score.tempoChanges) {
    if (tc.measureNumber <= measureNumber) tempo = tc.tempo
    else break
  }
  return tempo
}

/**
 * Build the sounding schedule as pure data. Extracted verbatim from the playback engine so audio,
 * the AI's analysis tools, and any future export all derive the SAME pitches and timing.
 *
 * `includeNoteIds` reproduces playback's "play only the selection" filter — applied BEFORE
 * tie-merge, exactly as the engine did. Omit it (analysis) to get the full schedule.
 */
export function buildSoundingSchedule(score: Score, opts?: { includeNoteIds?: Set<string> }): SoundingSchedule {
  const includeNoteIds = opts?.includeNoteIds
  const measureCount = Math.max(0, ...score.parts.map(p => p.measures.length))
  const allHeads: ScheduledHead[] = []
  let totalSec = 0

  for (const part of score.parts) {
    const resolved = resolvePartAccidentals(part.measures, part.ties, score.globalKeySig)
    const dynamicAt = buildDynamicMap(part)

    // Pass 1: lay out each note onset (per voice, barline-aligned) with resolved MIDI.
    interface Onset { noteId: string; pitchId: string; voice: VoiceNumber; midi: number; time: number; duration: number; measureNumber: number; articulations: ArticulationType[]; dynamic: number }
    const onsets: Onset[] = []
    let absTime = 0
    for (let mIdx = 0; mIdx < measureCount; mIdx++) {
      // parts[0]'s overrides drive the barline grid so all parts stay aligned (shared time sig).
      const timeSig = effectiveTimeSigAt(score.parts[0]?.measures ?? [], mIdx, score.globalTimeSig)
      const measure = part.measures[mIdx]
      const measureNum = measure?.number ?? (mIdx + 1)
      const tempo = effectiveTempo(score, measureNum)
      const measureDuration = measureCapacity(timeSig) * (60 / tempo)
      const measureStart = absTime
      if (measure && measure.notes.length > 0) {
        for (const voice of [1, 2] as const) {
          const voiceNotes = measure.notes.filter(e => e.voice === voice)
          if (voiceNotes.length === 0) continue
          let voiceTime = measureStart
          for (const event of voiceNotes) {
            const dur = eventDurationSeconds(event, tempo, measure.tuplets)
            if (event.type === 'note' && (!includeNoteIds || includeNoteIds.size === 0 || includeNoteIds.has(event.id))) {
              const arts = (event.articulations ?? []).map(a => a.type)
              const dyn = dynamicForMeasure(dynamicAt, measureNum)
              for (const pitch of event.pitches) {
                const offset = resolved.get(pitch.id) ?? 0
                const midi = (pitch.octave + 1) * 12 + NOTE_MIDI[pitch.step] + offset
                onsets.push({ noteId: event.id, pitchId: pitch.id, voice, midi, time: voiceTime, duration: dur, measureNumber: measureNum, articulations: arts, dynamic: dyn })
              }
            }
            voiceTime += dur
          }
        }
      }
      absTime = measureStart + measureDuration
    }

    // Pass 2: tie-merge per notehead. A genuine tie (same sounding pitch) extends the earlier
    // head over its continuation and suppresses the continuation's re-attack; chains (C–C–C).
    const headKey = (noteId: string, pitchId: string) => `${noteId}|${pitchId}`
    const byHead = new Map<string, Onset>()
    for (const o of onsets) byHead.set(headKey(o.noteId, o.pitchId), o)
    const nextHead = new Map<string, string>()
    const isContinuation = new Set<string>()
    for (const tie of part.ties ?? []) {
      const fromKey = headKey(tie.from.note, tie.from.pitch)
      const toKey = headKey(tie.to.note, tie.to.pitch)
      const a = byHead.get(fromKey)
      const b = byHead.get(toKey)
      if (!a || !b || a.midi !== b.midi) continue   // missing head, or a slur → no merge
      nextHead.set(fromKey, toKey)
      isContinuation.add(toKey)
    }

    for (const [key, o] of byHead) {
      if (isContinuation.has(key)) continue
      let dur = o.duration
      for (let cur = nextHead.get(key); cur; cur = nextHead.get(cur)) dur += byHead.get(cur)!.duration
      allHeads.push({
        partId: part.id, noteId: o.noteId, pitchId: o.pitchId, voice: o.voice,
        midi: o.midi, noteName: midiToName(o.midi), startSec: o.time, durSec: dur, measureNumber: o.measureNumber,
        articulations: o.articulations, dynamic: o.dynamic,
      })
    }

    totalSec = Math.max(totalSec, absTime)
  }

  return { heads: allHeads, totalSec }
}

// ── dynamics → velocity ───────────────────────────────────────────────────────
// Annotations anchor to a measure (not a beat), so dynamics resolve per-measure: a note uses the
// most recent dynamic at or before its measure. Coarse but a real expressive improvement.
const DYN_VELOCITY: Record<string, number> = {
  ppp: 0.2, pp: 0.32, p: 0.45, mp: 0.58, mf: 0.7, f: 0.82, ff: 0.92, fff: 1,
}

function buildDynamicMap(part: { measures: { id: string; number: number }[]; annotations?: { kind: string }[] }): [number, number][] {
  const numberOf = new Map(part.measures.map(m => [m.id, m.number]))
  const out: [number, number][] = []
  for (const a of part.annotations ?? []) {
    if (a.kind !== 'glyph') continue
    const g = a as { symbolId?: string; anchor?: { measureId: string } }
    if (!g.symbolId?.startsWith('dyn.') || !g.anchor) continue
    const vel = DYN_VELOCITY[g.symbolId.slice(4)]
    const mNum = numberOf.get(g.anchor.measureId)
    if (vel != null && mNum != null) out.push([mNum, vel])
  }
  return out.sort((a, b) => a[0] - b[0])
}

function dynamicForMeasure(map: [number, number][], measureNumber: number): number {
  let vel = 1   // no dynamic marked → full velocity (preserves prior playback loudness)
  for (const [m, v] of map) {
    if (m <= measureNumber) vel = v
    else break
  }
  return vel
}
