import type { Score, Note, Rest, NoteEvent, Part, Measure, Pitch, Tuplet, VoiceNumber } from '../../types/score'
import { eventBeatsR } from '../beats'

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
 * MusicXML <divisions> per quarter note for a part. A note's <duration> is its *sounded* length
 * in divisions; that must be an integer for every event. `eventBeatsR` gives the exact sounded
 * length (in quarter beats) as a reduced fraction, including nested-tuplet scaling AND dotted
 * values, so we set divisions = lcm of all those denominators. This is exact for any combination
 * (e.g. nested 3:2 → 9ths, dotted-sixteenth → 8ths) — no fixed base to overflow.
 */
function partDivisions(part: Part): number {
  let l = 1
  for (const m of part.measures)
    for (const ev of m.notes) l = lcm(l, eventBeatsR(ev, m.tuplets).den)
  return l
}

/**
 * The innermost tuplet an event belongs to (the one not serving as parent to another containing
 * tuplet), plus whether it begins/ends that group and the *cumulative* ratio against the written
 * note value. The cumulative ratio (product of the whole parent chain) is what MusicXML's
 * <time-modification> expects, and it makes sounded durations round-trip exactly even if the
 * importer flattens the nesting into a single tuplet.
 */
function tupletContext(
  event: NoteEvent,
  tuplets?: Tuplet[],
): { tuplet: Tuplet; isFirst: boolean; isLast: boolean; actual: number; normal: number } | null {
  const containing = (tuplets ?? []).filter(t => t.memberIds.includes(event.id))
  if (containing.length === 0) return null
  const tuplet = containing.find(t => !containing.some(o => o.parentId === t.id)) ?? containing[0]

  // Cumulative actual:normal = product of played:inSpaceOf up the parent chain.
  let actual = tuplet.played
  let normal = tuplet.inSpaceOf
  let parentId = tuplet.parentId
  const seen = new Set<string>([tuplet.id])
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = (tuplets ?? []).find(t => t.id === parentId)
    if (!parent) break
    actual *= parent.played
    normal *= parent.inSpaceOf
    parentId = parent.parentId
  }

  return {
    tuplet,
    isFirst: tuplet.memberIds[0] === event.id,
    isLast: tuplet.memberIds[tuplet.memberIds.length - 1] === event.id,
    actual,
    normal,
  }
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
  // Sounded duration in divisions, tuplet-scaled. divisions is sized (partDivisions) so this is
  // always an exact integer for any nesting/dotting. <type> stays the written value.
  const beatsR = eventBeatsR(event, tuplets)
  const dur = Math.round((beatsR.num * divisions) / beatsR.den)
  const voiceTag = `<voice>${event.voice}</voice>`
  const tctx = tupletContext(event, tuplets)
  // Cumulative actual:normal so nested ratios round-trip even if the importer flattens them.
  const timeMod = tctx
    ? `<time-modification><actual-notes>${tctx.actual}</actual-notes><normal-notes>${tctx.normal}</normal-notes></time-modification>`
    : ''
  // <tuplet> bracket notation on the group's first/last member only.
  const tupletNotation = tctx && (tctx.isFirst || tctx.isLast)
    ? `<notations>${tctx.isFirst ? '<tuplet type="start" bracket="yes"/>' : ''}${tctx.isLast ? '<tuplet type="stop"/>' : ''}</notations>`
    : ''

  if (event.type === 'rest') {
    const rest = event as Rest
    return `<note><rest/><duration>${dur}</duration>${voiceTag}<type>${durationToType(rest.duration)}</type>${rest.dots > 0 ? '<dot/>' : ''}${timeMod}${tupletNotation}</note>`
  }

  const note = event as Note
  // MusicXML represents chords with <chord/> elements on subsequent notes sharing a beat.
  // For the primary pitch we emit a normal note; additional pitches use <chord/>.
  const dots = note.dots > 0 ? '<dot/>' : ''
  const tie  = note.tied ? '<tie type="start"/>' : ''

  return note.pitches.map((pitch, idx) => {
    const chord = idx > 0 ? '<chord/>' : ''
    // Tuplet bracket notation belongs on the primary notehead only; time-modification + voice on all.
    const tail = `<duration>${dur}</duration>${voiceTag}<type>${durationToType(note.duration)}</type>${dots}${tie}${timeMod}${idx === 0 ? tupletNotation : ''}`
    return `<note>${chord}\n  ${pitchToXML(pitch)}\n  ${tail}\n</note>`
  }).join('\n')
}

function measureToXML(measure: Measure, number: number, divisions: number, timeSig?: Score['globalTimeSig'], keySig?: Score['globalKeySig']): string {
  const timeSigXML = timeSig
    ? `<time><beats>${timeSig.beats}</beats><beat-type>${timeSig.beatType}</beat-type></time>`
    : ''
  const keySigXML = keySig ? `<key><fifths>${keySig.fifths}</fifths><mode>${keySig.mode}</mode></key>` : ''

  // MusicXML is single-cursor: each voice is written in full, then a <backup> rewinds the cursor
  // by the voice's sounded length so the next voice starts at the same barline. Without this the
  // voices would play sequentially instead of concurrently. Voices with no events are skipped.
  const voices = ([1, 2] as VoiceNumber[]).filter(v => measure.notes.some(n => n.voice === v))
  const voicedSounded = (v: VoiceNumber) =>
    measure.notes
      .filter(n => n.voice === v)
      .reduce((sum, n) => sum + Math.round((eventBeatsR(n, measure.tuplets).num * divisions) / eventBeatsR(n, measure.tuplets).den), 0)

  const body = voices
    .map((v, vi) => {
      const xml = measure.notes
        .filter(n => n.voice === v)
        .map(n => noteToXML(n, divisions, measure.tuplets))
        .join('\n  ')
      // Rewind before every voice after the first.
      const prevDur = vi > 0 ? voicedSounded(voices[vi - 1]) : 0
      const backup = prevDur > 0 ? `<backup><duration>${prevDur}</duration></backup>\n  ` : ''
      return backup + xml
    })
    .join('\n  ')

  return `<measure number="${number}">
  <attributes>
    <divisions>${divisions}</divisions>
    ${keySigXML}
    ${timeSigXML}
  </attributes>
  ${body}
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
