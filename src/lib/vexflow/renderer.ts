import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental as VexAccidental,
  Dot,
} from 'vexflow'
import type { Measure, Note, NoteEvent, Pitch, TimeSig, KeySig } from '../../types/score'

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

export function midiToPitch(midi: number): Pitch {
  const octave = Math.floor(midi / 12) - 1
  const semitone = midi % 12
  const chromatic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
  const accidentals: Array<'sharp' | null> = [null, 'sharp', null, 'sharp', null, null, 'sharp', null, 'sharp', null, 'sharp', null]
  const step = NOTE_NAMES[chromatic[semitone]] as Pitch['step']
  return { step, octave, accidental: accidentals[semitone] }
}

function pitchToVexKey(pitch: Pitch): string {
  const acc = pitch.accidental === 'sharp' ? '#' : pitch.accidental === 'flat' ? 'b' : ''
  return `${pitch.step}${acc}/${pitch.octave}`
}

function durationToVex(dur: NoteEvent['duration'], dots: number): string {
  const map: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', sixteenth: '16' }
  return map[dur] + (dots > 0 ? 'd' : '')
}

function accidentalToVex(acc: Pitch['accidental']): string | null {
  const map: Record<string, string> = { sharp: '#', flat: 'b', natural: 'n', double_sharp: '##', double_flat: 'bb' }
  return acc ? (map[acc] ?? null) : null
}

export interface RenderScoreOptions {
  container: HTMLElement
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  width?: number
  staveY?: number
}

export function renderStaff({ container, measures, timeSig, keySig: _keySig, width = 800, staveY = 40 }: RenderScoreOptions): void {
  container.innerHTML = ''

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  renderer.resize(width, 160)
  const ctx = renderer.getContext()

  let x = 10
  const staveWidth = Math.floor((width - 10) / measures.length)

  measures.forEach((measure, idx) => {
    const stave = new Stave(x, staveY, staveWidth)

    if (idx === 0) {
      stave.addClef('treble')
      stave.addTimeSignature(`${timeSig.beats}/${timeSig.beatType}`)
    }

    stave.setContext(ctx).draw()

    const vexNotes = measure.notes.map(event => {
      if (event.type === 'rest') {
        const vn = new StaveNote({ keys: ['b/4'], duration: durationToVex(event.duration, event.dots) + 'r' })
        if (event.dots > 0) Dot.buildAndAttach([vn], { all: true })
        return vn
      }

      const note = event as Note
      const vn = new StaveNote({
        keys: [pitchToVexKey(note.pitch)],
        duration: durationToVex(note.duration, note.dots),
      })
      const vexAcc = accidentalToVex(note.pitch.accidental)
      if (vexAcc) vn.addModifier(new VexAccidental(vexAcc), 0)
      if (note.dots > 0) Dot.buildAndAttach([vn], { all: true })
      return vn
    })

    if (vexNotes.length > 0) {
      const voice = new Voice({ numBeats: timeSig.beats, beatValue: timeSig.beatType })
        .setStrict(false)
        .addTickables(vexNotes)
      new Formatter().joinVoices([voice]).format([voice], staveWidth - 20)
      voice.draw(ctx, stave)
    }

    x += staveWidth
  })
}
