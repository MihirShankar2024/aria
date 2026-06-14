import * as Tone from 'tone'
import type { Score, Note } from '../../types/score'
import { loadSoundFont } from './soundfonts'

const NOTE_MIDI: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

function noteToFreq(note: Note): string {
  const base = NOTE_MIDI[note.pitch.step]
  const accidentalOffset =
    note.pitch.accidental === 'sharp' || note.pitch.accidental === 'double_sharp'
      ? note.pitch.accidental === 'double_sharp' ? 2 : 1
      : note.pitch.accidental === 'flat' || note.pitch.accidental === 'double_flat'
        ? note.pitch.accidental === 'double_flat' ? -2 : -1
        : 0
  const midi = (note.pitch.octave + 1) * 12 + base + accidentalOffset
  return Tone.Frequency(midi, 'midi').toNote()
}

function durationToTone(dur: Note['duration'], dots: number): Tone.Unit.Time {
  const base: Record<string, string> = {
    whole: '1n', half: '2n', quarter: '4n', eighth: '8n', sixteenth: '16n',
  }
  if (dots === 0) return base[dur] as Tone.Unit.Time
  // Tone.js dotted notation is a trailing period (e.g. "4n."), not "d".
  return `${base[dur]}.` as Tone.Unit.Time
}

export async function buildAndPlayScore(score: Score, onStop?: () => void): Promise<void> {
  await Tone.start()
  Tone.getTransport().cancel()
  Tone.getTransport().stop()
  Tone.getTransport().bpm.value = score.tempo

  const parts = await Promise.all(
    score.parts.map(async part => ({
      part,
      sampler: await loadSoundFont(part.instrument),
    })),
  )

  let time = 0
  const measureCount = Math.max(...score.parts.map(p => p.measures.length))

  for (let mIdx = 0; mIdx < measureCount; mIdx++) {
    const timeSig = score.parts[0]?.measures[mIdx]?.timeSig ?? score.globalTimeSig
    const beatsPerMeasure = timeSig.beats

    for (const { part, sampler } of parts) {
      const measure = part.measures[mIdx]
      if (!measure) continue

      let beatOffset = 0
      for (const event of measure.notes) {
        if (event.type === 'note') {
          const freq = noteToFreq(event)
          const dur = durationToTone(event.duration, event.dots)
          sampler.triggerAttackRelease(freq, dur, `+${time + beatOffset}`)
        }
        const durationBeats =
          { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 }[event.duration] *
          (event.dots > 0 ? 1.5 : 1)
        beatOffset += durationBeats * (60 / score.tempo)
      }
    }

    time += beatsPerMeasure * (60 / score.tempo)
  }

  Tone.getTransport().scheduleOnce(() => onStop?.(), `+${time}`)
  Tone.getTransport().start()
}

export function stopPlayback(): void {
  Tone.getTransport().stop()
  Tone.getTransport().cancel()
}
