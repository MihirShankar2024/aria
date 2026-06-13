import type { Score, Note, Rest, NoteEvent, Part, Measure } from '../../types/score'

function accidentalToAlter(acc: Note['pitch']['accidental']): number {
  const map: Record<string, number> = { sharp: 1, flat: -1, natural: 0, double_sharp: 2, double_flat: -2 }
  return acc ? (map[acc] ?? 0) : 0
}

function durationToType(dur: NoteEvent['duration']): string {
  const map: Record<string, string> = {
    whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th',
  }
  return map[dur]
}

function durationToDivisions(dur: NoteEvent['duration'], dots: number): number {
  const base: Record<string, number> = { whole: 16, half: 8, quarter: 4, eighth: 2, sixteenth: 1 }
  const b = base[dur]
  return dots > 0 ? Math.round(b * 1.5) : b
}

function noteToXML(event: NoteEvent): string {
  if (event.type === 'rest') {
    const rest = event as Rest
    return `<note><rest/><duration>${durationToDivisions(rest.duration, rest.dots)}</duration><type>${durationToType(rest.duration)}</type>${rest.dots > 0 ? '<dot/>' : ''}</note>`
  }

  const note = event as Note
  const alter = accidentalToAlter(note.pitch.accidental)
  const accidentalTag = note.pitch.accidental
    ? `<accidental>${note.pitch.accidental.replace('_', '-')}</accidental>`
    : ''

  return `<note>
  <pitch>
    <step>${note.pitch.step}</step>
    ${alter !== 0 ? `<alter>${alter}</alter>` : ''}
    <octave>${note.pitch.octave}</octave>
  </pitch>
  <duration>${durationToDivisions(note.duration, note.dots)}</duration>
  <type>${durationToType(note.duration)}</type>
  ${note.dots > 0 ? '<dot/>' : ''}
  ${accidentalTag}
  ${note.tied ? '<tie type="start"/>' : ''}
</note>`
}

function measureToXML(measure: Measure, number: number, timeSig?: Score['globalTimeSig'], keySig?: Score['globalKeySig']): string {
  const timeSigXML = timeSig
    ? `<time><beats>${timeSig.beats}</beats><beat-type>${timeSig.beatType}</beat-type></time>`
    : ''
  const keySigXML = keySig ? `<key><fifths>${keySig.fifths}</fifths><mode>${keySig.mode}</mode></key>` : ''

  return `<measure number="${number}">
  <attributes>
    <divisions>4</divisions>
    ${keySigXML}
    ${timeSigXML}
  </attributes>
  ${measure.notes.map(noteToXML).join('\n  ')}
</measure>`
}

function partToXML(part: Part, score: Score): string {
  return `<part id="${part.id}">
  ${part.measures.map((m, i) => measureToXML(
    m,
    m.number,
    i === 0 ? score.globalTimeSig : m.timeSig,
    i === 0 ? score.globalKeySig : m.keySig,
  )).join('\n  ')}
</part>`
}

export function scoreToMusicXML(score: Score): string {
  const partList = score.parts
    .map(p => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`)
    .join('\n    ')

  const parts = score.parts.map(p => partToXML(p, score)).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${score.title}</work-title></work>
  <part-list>
    ${partList}
  </part-list>
  ${parts}
</score-partwise>`
}
