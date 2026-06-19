import type { Score, Note, Rest, NoteEvent, Part, Measure, Pitch, Tuplet } from '../../types/score'
import { eventBeats } from '../beats'

function accidentalToAlter(acc: Pitch['accidental']): number {
  const map: Record<string, number> = { sharp: 1, flat: -1, natural: 0, double_sharp: 2, double_flat: -2 }
  return acc ? (map[acc] ?? 0) : 0
}

function durationToType(dur: NoteEvent['duration']): string {
  const map: Record<string, string> = {
    whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th',
  }
  return map[dur]
}

function gcd(a: number, b: number): number { while (b) { [a, b] = [b, a % b] } return a || 1 }
function lcm(a: number, b: number): number { return (a * b) / gcd(a, b) }

/**
 * MusicXML <divisions> per quarter note for a part. A tuplet member's *sounded* duration is
 * `written × inSpaceOf/played`, so divisions must be divisible by every `played` (and by 4, our
 * sixteenth base) to keep every sounded duration an integer. = 4 × lcm(all played), = 4 when no
 * tuplets (matching the previous fixed value).
 */
function partDivisions(part: Part): number {
  let l = 1
  for (const m of part.measures) for (const t of m.tuplets ?? []) l = lcm(l, t.played)
  return 4 * l
}

/** The tuplet an event belongs to, plus whether it begins/ends the group. */
function tupletContext(event: NoteEvent, tuplets?: Tuplet[]): { tuplet: Tuplet; isFirst: boolean; isLast: boolean } | null {
  const tuplet = tuplets?.find(t => t.memberIds.includes(event.id))
  if (!tuplet) return null
  return { tuplet, isFirst: tuplet.memberIds[0] === event.id, isLast: tuplet.memberIds[tuplet.memberIds.length - 1] === event.id }
}

function pitchToXML(pitch: Pitch): string {
  const alter = accidentalToAlter(pitch.accidental)
  const accidentalTag = pitch.accidental
    ? `<accidental>${pitch.accidental.replace('_', '-')}</accidental>`
    : ''
  return `<pitch>
    <step>${pitch.step}</step>
    ${alter !== 0 ? `<alter>${alter}</alter>` : ''}
    <octave>${pitch.octave}</octave>
  </pitch>
  ${accidentalTag}`
}

function noteToXML(event: NoteEvent, divisions: number, tuplets?: Tuplet[]): string {
  // Sounded duration in divisions, tuplet-scaled (= written × inSpaceOf/played). divisions is
  // sized so this is always an integer. <type> stays the written value.
  const dur = Math.round(eventBeats(event, tuplets) * divisions)
  const tctx = tupletContext(event, tuplets)
  const timeMod = tctx
    ? `<time-modification><actual-notes>${tctx.tuplet.played}</actual-notes><normal-notes>${tctx.tuplet.inSpaceOf}</normal-notes></time-modification>`
    : ''
  // <tuplet> bracket notation on the group's first/last member only.
  const tupletNotation = tctx && (tctx.isFirst || tctx.isLast)
    ? `<notations>${tctx.isFirst ? '<tuplet type="start" bracket="yes"/>' : ''}${tctx.isLast ? '<tuplet type="stop"/>' : ''}</notations>`
    : ''

  if (event.type === 'rest') {
    const rest = event as Rest
    return `<note><rest/><duration>${dur}</duration><type>${durationToType(rest.duration)}</type>${rest.dots > 0 ? '<dot/>' : ''}${timeMod}${tupletNotation}</note>`
  }

  const note = event as Note
  // MusicXML represents chords with <chord/> elements on subsequent notes sharing a beat.
  // For the primary pitch we emit a normal note; additional pitches use <chord/>.
  const dots = note.dots > 0 ? '<dot/>' : ''
  const tie  = note.tied ? '<tie type="start"/>' : ''

  return note.pitches.map((pitch, idx) => {
    const chord = idx > 0 ? '<chord/>' : ''
    // Tuplet bracket notation belongs on the primary notehead only; time-modification on all.
    const tail = `<duration>${dur}</duration><type>${durationToType(note.duration)}</type>${dots}${tie}${timeMod}${idx === 0 ? tupletNotation : ''}`
    return `<note>${chord}\n  ${pitchToXML(pitch)}\n  ${tail}\n</note>`
  }).join('\n')
}

function measureToXML(measure: Measure, number: number, divisions: number, timeSig?: Score['globalTimeSig'], keySig?: Score['globalKeySig']): string {
  const timeSigXML = timeSig
    ? `<time><beats>${timeSig.beats}</beats><beat-type>${timeSig.beatType}</beat-type></time>`
    : ''
  const keySigXML = keySig ? `<key><fifths>${keySig.fifths}</fifths><mode>${keySig.mode}</mode></key>` : ''

  return `<measure number="${number}">
  <attributes>
    <divisions>${divisions}</divisions>
    ${keySigXML}
    ${timeSigXML}
  </attributes>
  ${measure.notes.map(n => noteToXML(n, divisions, measure.tuplets)).join('\n  ')}
</measure>`
}

function partToXML(part: Part, score: Score): string {
  const divisions = partDivisions(part)
  return `<part id="${part.id}">
  ${part.measures.map((m, i) => measureToXML(
    m,
    m.number,
    divisions,
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
