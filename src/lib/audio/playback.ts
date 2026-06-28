import * as Tone from 'tone'
import type { Score, Note, NoteEvent, Tuplet } from '../../types/score'
import { loadSoundFont } from './soundfonts'
import { effectiveTimeSigAt, eventBeats, measureCapacity } from '../beats'
import { resolvePartAccidentals } from '../accidentals'

const NOTE_MIDI: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

// Sounded seconds for an event, including any tuplet scaling (a triplet member sounds
// shorter than its written value), so playback timing matches the engraved rhythm.
function eventDurationSeconds(event: NoteEvent, tempo: number, tuplets?: Tuplet[]): number {
  return eventBeats(event, tuplets) * (60 / tempo)
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

export async function buildAndPlayScore(score: Score, onStop?: () => void, selectedNoteIds?: Set<string>, partVolumes?: Record<string, number>): Promise<void> {
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
    // Per-part playback volume as note velocity (0–1). Applied per trigger rather than on
    // the sampler, since loadSoundFont caches one sampler per instrument — two parts on the
    // same instrument share it, so setting sampler.volume would cross-contaminate them.
    const partVelocity = Math.max(0, Math.min(1, partVolumes?.[part.id] ?? 1))
    const scheduled: ScheduledNote[] = []
    let absTime = 0

    // Sounding accidental per notehead (key sig + measure carry + tie carry), resolved once
    // so playback, rendering, and serialization all derive the same pitch. Keyed by Pitch.id.
    const resolved = resolvePartAccidentals(part.measures, part.ties, score.globalKeySig)

    for (let mIdx = 0; mIdx < measureCount; mIdx++) {
      // Effective time sig: most recent override at/before this measure, else global.
      const timeSig = effectiveTimeSigAt(score.parts[0]?.measures ?? [], mIdx, score.globalTimeSig)
      const measure  = part.measures[mIdx]
      const measureNum = measure?.number ?? (mIdx + 1)
      const tempo    = getEffectiveTempo(score, measureNum)

      // Quarter-note beats per bar (NOT timeSig.beats — that's the numerator, which is
      // eighths in 6/8). measureCapacity gives (beats/beatType)*4, matching eventBeats' units.
      const measureDuration = measureCapacity(timeSig) * (60 / tempo)
      const measureStart = absTime
      if (measure && measure.notes.length > 0) {
        // Each voice is an independent timeline that starts at the barline, so they
        // sound concurrently.
        for (const voice of [1, 2] as const) {
          const voiceNotes = measure.notes.filter(e => e.voice === voice)
          if (voiceNotes.length === 0) continue
          let voiceTime = measureStart
          for (const event of voiceNotes) {
            const dur = eventDurationSeconds(event, tempo, measure.tuplets)
            if (event.type === 'note') {
              const midis = event.pitches.map(pitch => {
                const offset = resolved.get(pitch.id) ?? 0
                return (pitch.octave + 1) * 12 + NOTE_MIDI[pitch.step] + offset
              })
              if (!selectedNoteIds || selectedNoteIds.size === 0 || selectedNoteIds.has(event.id)) {
                scheduled.push({ note: event, time: voiceTime, duration: dur, tempo, midis })
              }
            }
            voiceTime += dur
          }
        }
      }
      // Always advance one full measure so parts/measures stay barline-aligned even when
      // a voice is incomplete (underfilled) or the measure is empty.
      absTime = measureStart + measureDuration
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
      transport.schedule(t => sampler.triggerAttackRelease(noteName, dur, t, partVelocity), time)
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
