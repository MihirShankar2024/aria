import type { Score, Part, Measure, NoteEvent, Note, Rest, Pitch, Duration, Accidental, TimeSig, KeySig } from '../../types/score'
import { newPitchId } from '../pitch'

function parseTimeSig(el: Element): TimeSig | undefined {
  const beats = el.querySelector('time > beats')?.textContent
  const beatType = el.querySelector('time > beat-type')?.textContent
  if (beats && beatType) return { beats: parseInt(beats), beatType: parseInt(beatType) }
  return undefined
}

function parseKeySig(el: Element): KeySig | undefined {
  const fifths = el.querySelector('key > fifths')?.textContent
  const mode = el.querySelector('key > mode')?.textContent
  if (fifths) return { fifths: parseInt(fifths), mode: (mode ?? 'major') as 'major' | 'minor' }
  return undefined
}

function parseNote(el: Element): NoteEvent {
  const isRest = !!el.querySelector('rest')
  const duration = (el.querySelector('type')?.textContent ?? 'quarter') as Duration
  const dots = el.querySelectorAll('dot').length

  if (isRest) {
    const rest: Rest = { id: crypto.randomUUID(), type: 'rest', duration, dots }
    return rest
  }

  const step = (el.querySelector('pitch > step')?.textContent ?? 'C') as Pitch['step']
  const octave = parseInt(el.querySelector('pitch > octave')?.textContent ?? '4')
  const alter = parseFloat(el.querySelector('pitch > alter')?.textContent ?? '0')
  const accidental: Accidental =
    alter === 1 ? 'sharp' : alter === -1 ? 'flat' : alter === 2 ? 'double_sharp' : alter === -2 ? 'double_flat' : null
  const tied = !!el.querySelector('tie[type="start"]')

  const note: Note = {
    id: crypto.randomUUID(),
    type: 'note',
    pitches: [{ id: newPitchId(), step, octave, accidental }],
    duration,
    dots,
    tied,
  }
  return note
}

function parseMeasure(el: Element): Measure {
  const number = parseInt(el.getAttribute('number') ?? '1')
  const notes: NoteEvent[] = Array.from(el.querySelectorAll('note')).map(parseNote)
  const timeSig = parseTimeSig(el)
  const keySig = parseKeySig(el)

  return { id: crypto.randomUUID(), number, notes, timeSig, keySig }
}

export function musicXMLToScore(xml: string, existingScore: Score): Score {
  // Strip markdown fences if Claude wrapped the response
  const cleaned = xml.replace(/```(?:xml)?\n?/g, '').trim()
  const parser = new DOMParser()
  const doc = parser.parseFromString(cleaned, 'application/xml')

  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid MusicXML: ' + doc.querySelector('parsererror')?.textContent)
  }

  const title = doc.querySelector('work-title')?.textContent ?? existingScore.title
  const tempo = existingScore.tempo

  const partEls = Array.from(doc.querySelectorAll('part'))
  const parts: Part[] = partEls.map((partEl, idx) => {
    const id = partEl.getAttribute('id') ?? crypto.randomUUID()
    const existing = existingScore.parts.find(p => p.id === id) ?? existingScore.parts[idx]
    const measures = Array.from(partEl.querySelectorAll('measure')).map(parseMeasure)
    return {
      id: existing?.id ?? id,
      name: existing?.name ?? `Part ${idx + 1}`,
      instrument: existing?.instrument ?? 'piano',
      clef: existing?.clef ?? 'treble',
      measures,
    }
  })

  const firstMeasure = partEls[0]?.querySelector('measure')
  const globalTimeSig = parseTimeSig(firstMeasure ?? document.createElement('div')) ?? existingScore.globalTimeSig
  const globalKeySig = parseKeySig(firstMeasure ?? document.createElement('div')) ?? existingScore.globalKeySig

  return { ...existingScore, title, tempo, globalTimeSig, globalKeySig, parts }
}
