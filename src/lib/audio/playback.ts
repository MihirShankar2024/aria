import * as Tone from 'tone'
import type { Score } from '../../types/score'
import { loadSoundFont } from './soundfonts'
import { buildSoundingSchedule } from '../playback/schedule'

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
  const samplerByPart = new Map(parts.map(p => [p.part.id, p.sampler]))

  // The sounding schedule (resolved pitch + timing + tie-merge) is now pure data, shared with the
  // AI's analysis "ears". Playback just triggers it. The selection filter is applied inside, before
  // tie-merge, exactly as before.
  const { heads, totalSec } = buildSoundingSchedule(score, { includeNoteIds: selectedNoteIds })

  for (const head of heads) {
    const sampler = samplerByPart.get(head.partId)
    if (!sampler) continue
    // Per-part playback volume × the marked dynamic × an accent boost = note velocity (0–1).
    // Applied per trigger rather than on the sampler, since loadSoundFont caches one sampler per
    // instrument — two parts on the same instrument would otherwise cross-contaminate.
    const partVol = Math.max(0, Math.min(1, partVolumes?.[head.partId] ?? 1))
    const accent = head.articulations.includes('accent') || head.articulations.includes('marcato') ? 1.25 : 1
    const velocity = Math.max(0, Math.min(1, partVol * head.dynamic * accent))
    // Articulation shaping: staccato/spiccato clip the note short, a fermata holds it longer.
    let durMul = 1
    if (head.articulations.includes('staccato') || head.articulations.includes('spiccato')) durMul = 0.5
    if (head.articulations.includes('fermata')) durMul = 1.8
    // Schedule on the transport (not via `+time`) so pause/resume halt and continue in lock-step.
    transport.schedule(t => sampler.triggerAttackRelease(head.noteName, head.durSec * durMul, t, velocity), head.startSec)
  }

  transport.scheduleOnce(() => onStop?.(), `+${totalSec}`)
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
