import * as Tone from 'tone'
import type { Score, Note, NoteEvent, Pitch, NoteName, Measure, KeySig } from '../../types/score'
import { loadSoundFont } from './soundfonts'

const NOTE_MIDI: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

// Standard order accidentals are added by a key signature.
const SHARP_ORDER: NoteName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER: NoteName[]  = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

// fifths → per-letter semitone offset implied by the key signature.
// e.g. D major (fifths 2) → { F: +1, C: +1 }.
function keySigOffsets(fifths: number): Partial<Record<NoteName, number>> {
  const map: Partial<Record<NoteName, number>> = {}
  if (fifths > 0) for (let i = 0; i < fifths; i++) map[SHARP_ORDER[i]] = 1
  else for (let i = 0; i < -fifths; i++) map[FLAT_ORDER[i]] = -1
  return map
}

// Semitone offset of a written accidental. Natural cancels to 0.
function explicitOffset(acc: Pitch['accidental']): number {
  switch (acc) {
    case 'double_sharp': return 2
    case 'sharp': return 1
    case 'natural': return 0
    case 'flat': return -1
    case 'double_flat': return -2
    default: return 0
  }
}

// Most recent keySig override at/before idx, else global. Mirrors the renderer's
// effectiveKeySigAt so playback matches what's drawn.
function effectiveKeySig(measures: Measure[], idx: number, global: KeySig): KeySig {
  for (let i = idx; i >= 0; i--) {
    if (measures[i]?.keySig) return measures[i].keySig!
  }
  return global
}

function eventDurationSeconds(event: NoteEvent, tempo: number): number {
  const beats = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 }[event.duration]
  return beats * (event.dots > 0 ? 1.5 : 1) * (60 / tempo)
}

// Returns the effective tempo at a given measure number.
function getEffectiveTempo(score: Score, measureNumber: number): number {
  let tempo = score.tempo
  for (const tc of score.tempoChanges) {
    if (tc.measureNumber <= measureNumber) tempo = tc.tempo
    else break
  }
  return tempo
}

interface ScheduledNote {
  note: Note
  time: number      // absolute seconds from start
  duration: number  // seconds
  tempo: number     // tempo active at this note (for tie-merging)
  midis: number[]   // resolved MIDI per pitch (key sig + measure accidentals applied)
}

// Samplers from the current playthrough, kept so pause/stop can silence any
// notes still ringing (their envelopes live on the audio clock, not the transport).
let activeSamplers: Tone.Sampler[] = []

export async function buildAndPlayScore(score: Score, onStop?: () => void, selectedNoteIds?: Set<string>): Promise<void> {
  await Tone.start()
  const transport = Tone.getTransport()
  transport.cancel()
  transport.stop()
  transport.position = 0
  transport.bpm.value = score.tempo

  const parts = await Promise.all(
    score.parts.map(async part => ({
      part,
      sampler: await loadSoundFont(part.instrument),
    })),
  )

  activeSamplers = parts.map(p => p.sampler)

  let totalTime = 0
  const measureCount = Math.max(...score.parts.map(p => p.measures.length))

  for (const { part, sampler } of parts) {
    const scheduled: ScheduledNote[] = []
    let absTime = 0

    // A tie continuation note (the `to`) inherits the sounding pitch of its
    // `from`, even across a barline where the accidental isn't re-written.
    // Keyed by note id (ties are per-notehead now; accidental carry is matched below by
    // pitch identity, so a slur to a different pitch still won't inherit anything).
    const tieFromOf = new Map<string, string>()
    for (const tie of part.ties ?? []) tieFromOf.set(tie.to.note, tie.from.note)
    // note id → resolved accidental offset per `${step}${octave}`. We carry the
    // *accidental* across a tie, keyed by pitch identity, so only a genuine tie
    // (same letter + octave) inherits it — a slur to a different pitch does not.
    const resolvedNoteOffsets = new Map<string, Map<string, number>>()

    for (let mIdx = 0; mIdx < measureCount; mIdx++) {
      // Effective time sig: look at measure-level override on first part, else global.
      const timeSig = score.parts[0]?.measures[mIdx]?.timeSig ?? score.globalTimeSig
      const measure  = part.measures[mIdx]
      const measureNum = measure?.number ?? (mIdx + 1)
      const tempo    = getEffectiveTempo(score, measureNum)

      // Active key signature and a fresh accidental memory per measure (barline reset).
      const keyMap = keySigOffsets(effectiveKeySig(part.measures, mIdx, score.globalKeySig).fifths)
      const measureAcc = new Map<string, number>()  // `${step}${octave}` → semitone offset

      const measureDuration = timeSig.beats * (60 / tempo)
      if (measure && measure.notes.length > 0) {
        for (const event of measure.notes) {
          const dur = eventDurationSeconds(event, tempo)
          if (event.type === 'note') {
            const fromId = tieFromOf.get(event.id)
            const fromOffsets = fromId ? resolvedNoteOffsets.get(fromId) : undefined
            const offsets = new Map<string, number>()
            const midis = event.pitches.map(pitch => {
              const memKey = `${pitch.step}${pitch.octave}`
              let offset: number
              if (pitch.accidental !== null) {
                offset = explicitOffset(pitch.accidental)
                measureAcc.set(memKey, offset)
              } else if (measureAcc.has(memKey)) {
                offset = measureAcc.get(memKey)!
              } else if (fromOffsets?.has(memKey)) {
                // Genuine tie continuation (same letter + octave, no written
                // accidental): carry the from-note's accidental. Per spec this does
                // NOT establish accidental memory for later notes, so don't set
                // measureAcc here. A slur to a different pitch won't match memKey.
                offset = fromOffsets.get(memKey)!
              } else {
                offset = keyMap[pitch.step] ?? 0
              }
              offsets.set(memKey, offset)
              return (pitch.octave + 1) * 12 + NOTE_MIDI[pitch.step] + offset
            })
            resolvedNoteOffsets.set(event.id, offsets)
            if (!selectedNoteIds || selectedNoteIds.size === 0 || selectedNoteIds.has(event.id)) {
              scheduled.push({ note: event, time: absTime, duration: dur, tempo, midis })
            }
          }
          absTime += dur
        }
      } else {
        // Empty or missing measure: infer a whole rest so all parts stay aligned.
        absTime += measureDuration
      }
    }

    // ── Per-notehead tie sustain ──────────────────────────────────────────────
    // Every notehead is its own voice. A genuine tie (the two heads resolve to the same
    // sounding pitch) extends the earlier head's duration over its continuation and
    // suppresses the continuation's re-attack; this chains (C–C–C). Slurs (different
    // pitch) and untied heads play normally. Each head has at most one incoming and one
    // outgoing tie (reducer dedups by head), so the tie graph is a set of simple chains.
    interface Voice { noteId: string; midi: number; noteName: string; time: number; duration: number }
    const headKey = (noteId: string, pitchId: string) => `${noteId}|${pitchId}`
    const voiceByHead = new Map<string, Voice>()
    for (const s of scheduled) {
      s.note.pitches.forEach((p, i) => {
        const midi = s.midis[i]
        voiceByHead.set(headKey(s.note.id, p.id), {
          noteId: s.note.id, midi,
          noteName: Tone.Frequency(midi, 'midi').toNote(),
          time: s.time, duration: s.duration,
        })
      })
    }

    // Link genuine ties head→head, and mark continuations so they aren't re-attacked.
    const nextHead = new Map<string, string>()
    const isContinuation = new Set<string>()
    for (const tie of part.ties ?? []) {
      const fromKey = headKey(tie.from.note, tie.from.pitch)
      const toKey   = headKey(tie.to.note, tie.to.pitch)
      const a = voiceByHead.get(fromKey)
      const b = voiceByHead.get(toKey)
      if (!a || !b || a.midi !== b.midi) continue  // missing head, or a slur → no merge
      nextHead.set(fromKey, toKey)
      isContinuation.add(toKey)
    }

    // Schedule one voice per head on the transport (not via `+time`) so pause/resume
    // halt and continue in lock-step. Chain starts absorb their continuations' durations.
    for (const [key, voice] of voiceByHead) {
      if (isContinuation.has(key)) continue       // sounded as part of an earlier head
      let dur = voice.duration
      for (let cur = nextHead.get(key); cur; cur = nextHead.get(cur)) {
        dur += voiceByHead.get(cur)!.duration
      }
      const { noteName, time } = voice
      transport.schedule(t => sampler.triggerAttackRelease(noteName, dur, t), time)
    }

    totalTime = Math.max(totalTime, absTime)
  }

  transport.scheduleOnce(() => onStop?.(), `+${totalTime}`)
  transport.start()
}

// Halt playback but keep the playhead position so a later resume continues from
// here. Also releases any sounding notes so nothing rings on past the pause.
export function pausePlayback(): void {
  Tone.getTransport().pause()
  for (const s of activeSamplers) s.releaseAll()
}

// Resume from the paused playhead position.
export function resumePlayback(): void {
  Tone.getTransport().start()
}

// Fully stop and rewind the playhead to the beginning, silencing all notes.
export function stopPlayback(): void {
  const transport = Tone.getTransport()
  transport.stop()
  transport.cancel()
  transport.position = 0
  for (const s of activeSamplers) s.releaseAll()
}
