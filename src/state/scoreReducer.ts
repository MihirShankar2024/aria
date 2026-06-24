import { produce } from 'immer'
import type { Score, Part, Measure, TimeSig, Pitch, NoteEvent, VoiceNumber, Tuplet, Rest } from '../types/score'
import type { ScoreAction } from './actions'
import { normalizeMeasureRests, fillMeasureWithRests } from '../lib/rests'
import { measureBeatCount, measureCapacity, measureRemainingBeats, noteBeatDuration, effectiveTimeSigAt } from '../lib/beats'
import { INSTRUMENT_DB } from '../lib/instruments'

const VOICES: readonly VoiceNumber[] = [1, 2]

function createDefaultMeasure(number: number): Measure {
  return { id: crypto.randomUUID(), number, notes: [] }
}

// Build the measure list for a brand-new part so it stays barline-aligned AND inherits
// the universal time/key-signature overrides already placed mid-score. Time sig and key
// sig live per-measure per-part (applied to every part via SET_SCORE_*_AT), so a fresh
// part built from blank measures would silently miss any change after measure 1 and break
// the "signatures are universal" invariant. We copy each override from a reference part
// (the first existing part — all parts share the same overrides) keyed by measure number.
// Tempo is already score-level (tempoChanges), so it needs no copying here.
function createInheritedMeasures(score: Score, count: number): Measure[] {
  const reference = score.parts[0]
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1
    const measure = createDefaultMeasure(number)
    const ref = reference?.measures.find(m => m.number === number)
    if (ref?.timeSig) measure.timeSig = ref.timeSig
    if (ref?.keySig) measure.keySig = ref.keySig
    return measure
  })
}

// Rest canonicalization walks a single linear timeline, so it must run per voice —
// otherwise it would merge/mis-group rests from two interleaved voices. Each voice's
// events are normalized independently and the result is re-stamped with its voice
// (rests created inside `normalizeMeasureRests` default to voice 1). The flat array
// comes back grouped voice-1-then-voice-2; renderer/ties don't depend on cross-voice
// order, and within-voice order is preserved.
function normalizeByVoice(notes: NoteEvent[], ts: TimeSig, tuplets?: Tuplet[]): NoteEvent[] {
  const out: NoteEvent[] = []
  const inTuplet = new Set(tuplets?.flatMap(t => t.memberIds) ?? [])
  for (const v of VOICES) {
    const ofVoice = notes.filter(n => n.voice === v)
    if (ofVoice.length === 0) continue
    // Rest canonicalization assumes a dyadic beat grid, which doesn't hold inside a tuplet.
    // If this voice carries any tuplet members, leave its events untouched so authored
    // tuplet content (and its rests) survives and no rest merges across a tuplet boundary.
    if (ofVoice.some(ev => inTuplet.has(ev.id))) {
      out.push(...ofVoice)
      continue
    }
    for (const ev of normalizeMeasureRests(ofVoice, ts)) {
      out.push(ev.voice === v ? ev : { ...ev, voice: v })
    }
  }
  return out
}

// Swap an id inside every tuplet's member list (a replaced rest/note keeps its tuplet
// slot rather than dissolving the group). Run before pruneTuplets on replace paths.
function remapTupletMember(measure: Measure, oldId: string, newId: string): void {
  if (!measure.tuplets) return
  for (const t of measure.tuplets) {
    const i = t.memberIds.indexOf(oldId)
    if (i !== -1) t.memberIds[i] = newId
    // Replacing a reserved rest (e.g. via normal entry) commits that slot — it's no longer empty.
    if (t.placeholderIds) t.placeholderIds = t.placeholderIds.filter(id => id !== oldId)
  }
}

// Drop tuplet members that no longer exist and tuplets that fall below two members, then
// orphan-clear any parentId whose parent was removed. Run after any note deletion/replace.
function pruneTuplets(measure: Measure): void {
  if (!measure.tuplets || measure.tuplets.length === 0) return
  const liveIds = new Set(measure.notes.map(n => n.id))
  let tuplets = measure.tuplets
    .map(t => ({
      ...t,
      memberIds: t.memberIds.filter(id => liveIds.has(id)),
      placeholderIds: t.placeholderIds?.filter(id => liveIds.has(id)),
    }))
    .filter(t => t.memberIds.length >= 2)
  const liveTupletIds = new Set(tuplets.map(t => t.id))
  tuplets = tuplets.map(t => (t.parentId && !liveTupletIds.has(t.parentId) ? { ...t, parentId: undefined } : t))
  measure.tuplets = tuplets.length ? tuplets : undefined
}

// Greedy-decompose a written beat length into rests (largest dyadic value first). Used to
// re-reserve the unused tail of a tuplet slot that a finer note splits. Tuplet slot lengths are
// dyadic down to a sixteenth, so this terminates with representable durations.
const REST_UNITS: [Rest['duration'], number][] = [['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 0.5], ['sixteenth', 0.25]]
function decomposeRests(beats: number, voice: VoiceNumber): Rest[] {
  const out: Rest[] = []
  let rem = beats
  for (const [duration, b] of REST_UNITS) {
    while (rem >= b - 1e-6) { out.push({ id: crypto.randomUUID(), type: 'rest', duration, dots: 0, voice }); rem -= b }
  }
  return out
}

// Pad each occupied voice's trailing gap with rests (the tool a user runs to complete
// a red voice). An empty measure fills voice 1.
function fillByVoice(notes: NoteEvent[], ts: TimeSig, tuplets?: Tuplet[]): NoteEvent[] {
  const occupied = VOICES.filter(v => notes.some(n => n.voice === v))
  const targets = occupied.length ? occupied : [1 as VoiceNumber]
  const inTuplet = new Set(tuplets?.flatMap(t => t.memberIds) ?? [])
  const out: NoteEvent[] = []
  for (const v of targets) {
    const ofVoice = notes.filter(n => n.voice === v)
    // Rest-fill uses the dyadic beat grid, invalid inside a tuplet — leave tuplet voices alone.
    if (ofVoice.some(ev => inTuplet.has(ev.id))) {
      out.push(...ofVoice)
      continue
    }
    for (const ev of fillMeasureWithRests(ofVoice, ts)) {
      out.push(ev.voice === v ? ev : { ...ev, voice: v })
    }
  }
  return out
}

export function createDefaultScore(): Score {
  const trumpet: Part = {
    id: crypto.randomUUID(),
    name: 'Trumpet in Bb',
    instrument: 'trumpet_bb',
    clef: 'treble',
    measures: [1, 2, 3, 4, 5, 6, 7, 8].map(createDefaultMeasure),
  }
  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    tempo: 100,
    globalTimeSig: { beats: 4, beatType: 4 },
    globalKeySig: { fifths: 0, mode: 'major' },
    parts: [trumpet],
    tempoChanges: [],
  }
}

// Compare two pitch arrays for equality (all elements must match).
function pitchArraysEqual(a: Pitch[], b: Pitch[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.step === b[i].step && p.octave === b[i].octave && p.accidental === b[i].accidental)
}

// Head identity key for a tie endpoint: event id + stable Pitch.id.
const headKey = (noteId: string, pitchId: string) => `${noteId}|${pitchId}`

// Drop ties whose endpoint notehead no longer exists (note or specific pitch removed).
// Run after any mutation that can delete a note or a chord tone.
function pruneUnresolvedTies(part: Part): void {
  if (!part.ties || part.ties.length === 0) return
  const heads = new Set<string>()
  for (const m of part.measures)
    for (const ev of m.notes)
      if (ev.type === 'note') for (const p of ev.pitches) heads.add(headKey(ev.id, p.id))
  part.ties = part.ties.filter(t => heads.has(headKey(t.from.note, t.from.pitch)) && heads.has(headKey(t.to.note, t.to.pitch)))
}

// Sort pitches low-to-high by (octave, step index).
const STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
function sortPitches(pitches: Pitch[]): Pitch[] {
  return [...pitches].sort((a, b) => {
    if (a.octave !== b.octave) return a.octave - b.octave
    return STEP_ORDER[a.step] - STEP_ORDER[b.step]
  })
}

export function scoreReducer(score: Score, action: ScoreAction): Score {
  return produce(score, draft => {
    switch (action.type) {
      case 'ADD_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes.push(action.note)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
        }
        break
      }
      case 'ADD_REST': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes.push(action.rest)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
        }
        break
      }
      case 'REPLACE_REST': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const idx = measure?.notes.findIndex(n => n.id === action.restId && n.type === 'rest') ?? -1
        if (measure && idx !== -1) {
          const rest = measure.notes[idx]
          const ts = effectiveTimeSig(draft, measure)
          // Reject only if swapping in the (longer) note would overflow the rest's own voice.
          const newTotal = measureBeatCount(measure, rest.voice) - noteBeatDuration(rest) + noteBeatDuration(action.note)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            remapTupletMember(measure, rest.id, action.note.id)
            measure.notes[idx] = action.note
            measure.notes = normalizeByVoice(measure.notes, ts, measure.tuplets)
            pruneTuplets(measure)
          }
        }
        break
      }
      case 'REPLACE_EVENT': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const idx = measure?.notes.findIndex(n => n.id === action.eventId) ?? -1
        if (measure && idx !== -1) {
          const old = measure.notes[idx]
          const ts = effectiveTimeSig(draft, measure)
          // Reject only if the swapped-in event would overflow the old event's own voice.
          const newTotal = measureBeatCount(measure, old.voice) - noteBeatDuration(old) + noteBeatDuration(action.event)
          if (newTotal <= measureCapacity(ts) + 0.001) {
            remapTupletMember(measure, old.id, action.event.id)
            measure.notes[idx] = action.event
            measure.notes = normalizeByVoice(measure.notes, ts, measure.tuplets)
            pruneTuplets(measure)
          }
        }
        break
      }
      case 'INSERT_EVENTS': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure && action.events.length > 0) {
          const at = Math.max(0, Math.min(action.index, measure.notes.length))
          measure.notes.splice(at, 0, ...action.events)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
        }
        break
      }
      case 'DELETE_NOTE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const measure = part?.measures.find(m => m.id === action.measureId)
        if (part && measure) {
          measure.notes = measure.notes.filter(n => n.id !== action.noteId)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
          pruneTuplets(measure)
          // Drop ties whose endpoint was just removed (no note left to draw to).
          if (part.ties) {
            part.ties = part.ties.filter(t => t.from.note !== action.noteId && t.to.note !== action.noteId)
          }
        }
        break
      }
      case 'ADD_TIES': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part && action.ties.length > 0) {
          part.ties ??= []
          // Dedup by *directed slot*, not just by head: a new tie evicts an existing tie
          // only when it occupies the same role on the same head — its `from` head leaves
          // forward, or its `to` head arrives from behind. This still prevents two curves
          // leaving (or two entering) one head, while letting a single head carry one
          // incoming tie (as `to`) and one outgoing tie (as `from`) — the long-tie chain
          // A→B then B→C. Other heads of the same chord keep their ties, so multiple ties
          // may still fan out from one chord.
          const newFromHeads = new Set(action.ties.map(t => headKey(t.from.note, t.from.pitch)))
          const newToHeads   = new Set(action.ties.map(t => headKey(t.to.note, t.to.pitch)))
          part.ties = part.ties.filter(
            t => !newFromHeads.has(headKey(t.from.note, t.from.pitch)) && !newToHeads.has(headKey(t.to.note, t.to.pitch)),
          )
          part.ties.push(...action.ties)
        }
        break
      }
      case 'REMOVE_TIE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part?.ties) part.ties = part.ties.filter(t => t.id !== action.tieId)
        break
      }
      case 'UPDATE_TIE_CURVE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const tie = part?.ties?.find(t => t.id === action.tieId)
        if (tie) tie.curve = { ...tie.curve, ...action.curve }
        break
      }
      case 'ADD_ANNOTATION': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          if (!part.annotations) part.annotations = []
          part.annotations.push(action.annotation)
        }
        break
      }
      case 'MOVE_ANNOTATION': {
        const ann = draft.parts.find(p => p.id === action.partId)?.annotations?.find(a => a.id === action.id)
        if (ann) ann.anchor = action.anchor
        break
      }
      case 'STRETCH_ANNOTATION': {
        const ann = draft.parts.find(p => p.id === action.partId)?.annotations?.find(a => a.id === action.id)
        if (ann && ann.kind === 'line') { ann.endDX = action.endDX; ann.endDY = action.endDY }
        break
      }
      case 'SCALE_ANNOTATION': {
        const ann = draft.parts.find(p => p.id === action.partId)?.annotations?.find(a => a.id === action.id)
        if (ann && ann.kind === 'glyph') { ann.scaleX = action.scaleX; ann.scaleY = action.scaleY }
        break
      }
      case 'UPDATE_TEXT_ANNOTATION': {
        const ann = draft.parts.find(p => p.id === action.partId)?.annotations?.find(a => a.id === action.id)
        if (ann && ann.kind === 'text') {
          if (action.text !== undefined) ann.text = action.text
          if (action.style !== undefined) ann.style = action.style
        }
        break
      }
      case 'DELETE_ANNOTATION': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part?.annotations) part.annotations = part.annotations.filter(a => a.id !== action.id)
        break
      }
      case 'UPDATE_GLYPH_OFFSET': {
        const note = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
          ?.notes.find(n => n.id === action.noteId)
        if (note && note.type === 'note') {
          const pitch = note.pitches[action.pitchIndex]
          if (pitch) {
            const key = action.kind === 'accidental' ? 'accidentalOffset' : 'dotOffset'
            const prev = pitch[key]
            // X is anchored to the notehead (absolute), Y accumulates the drag delta.
            pitch[key] = { dx: action.ax, dy: (prev?.dy ?? 0) + action.dy }
          }
        }
        break
      }
      case 'UPDATE_ARTICULATION_OFFSET': {
        const event = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
          ?.notes.find(n => n.id === action.noteId)
        const art = event?.articulations?.find(a => a.type === action.artType)
        if (art) {
          // X is anchored to the notehead (absolute); Y accumulates the drag delta.
          art.offset = { dx: action.dx, dy: (art.offset?.dy ?? 0) + action.dy }
        }
        break
      }
      case 'APPLY_MEASURE_NOTES': {
        const touchedParts = new Set<string>()
        for (const edit of action.edits) {
          const measure = draft.parts
            .find(p => p.id === edit.partId)
            ?.measures.find(m => m.id === edit.measureId)
          if (measure) { measure.notes = edit.notes; pruneTuplets(measure); touchedParts.add(edit.partId) }
        }
        // Drop ties whose endpoint notehead no longer exists — covers whole-note removal
        // and per-pitch deletion (a chord tone stripped while the note remains).
        for (const partId of touchedParts) {
          const part = draft.parts.find(p => p.id === partId)
          if (part) pruneUnresolvedTies(part)
        }
        break
      }
      case 'FILL_MEASURE_RESTS': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) {
          measure.notes = fillByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
        }
        break
      }
      case 'UPDATE_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId)
        if (measure && note) {
          Object.assign(note, action.patch)
          measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
        }
        break
      }
      case 'ADD_CHORD_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId && n.type === 'note')
        if (note && note.type === 'note') {
          // A chord can't hold two noteheads on the same staff line/space, so reject any
          // pitch whose step+octave already occupies that position — whether an exact
          // duplicate (C♮ + C♮) or an enharmonic clash (C♮ + C♯, which is engraved as C + D♭).
          const occupied = note.pitches.some(
            p => p.step === action.pitch.step && p.octave === action.pitch.octave,
          )
          if (!occupied) {
            note.pitches = sortPitches([...note.pitches, action.pitch])
          }
          // A selected articulation chord-stacks onto the whole event (mirrors the accidental
          // riding the new tone): add it to the event's set if not already present.
          if (action.articulation && !note.articulations?.some(a => a.type === action.articulation)) {
            note.articulations = [...(note.articulations ?? []), { type: action.articulation }]
          }
        }
        break
      }
      case 'REMOVE_CHORD_NOTE': {
        const part = draft.parts.find(p => p.id === action.partId)
        const measure = part?.measures.find(m => m.id === action.measureId)
        const note = measure?.notes.find(n => n.id === action.noteId && n.type === 'note')
        if (part && measure && note && note.type === 'note') {
          note.pitches = note.pitches.filter(
            p => !(p.step === action.pitch.step && p.octave === action.pitch.octave && p.accidental === action.pitch.accidental),
          )
          // If all pitches removed, delete the note entirely.
          if (note.pitches.length === 0) {
            measure.notes = measure.notes.filter(n => n.id !== action.noteId)
            measure.notes = normalizeByVoice(measure.notes, effectiveTimeSig(draft, measure), measure.tuplets)
            pruneTuplets(measure)
          }
          // Drop ties on the removed head (whole note or just this chord tone).
          pruneUnresolvedTies(part)
        }
        break
      }
      case 'CREATE_TUPLET': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (!measure || action.memberIds.length < 2 || action.played < 2 || action.inSpaceOf < 1) break
        // Members must be real events of a single voice and contiguous in that voice's order.
        const memberSet = new Set(action.memberIds)
        const members = measure.notes.filter(n => memberSet.has(n.id))
        if (members.length !== action.memberIds.length) break
        const voice = members[0].voice
        if (members.some(m => m.voice !== voice)) break
        const voiceOrder = measure.notes.filter(n => n.voice === voice).map(n => n.id)
        const positions = action.memberIds.map(id => voiceOrder.indexOf(id)).sort((a, b) => a - b)
        const contiguous = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1)
        if (!contiguous) break
        // Keep members in voice order regardless of selection order.
        const orderedIds = voiceOrder.filter(id => memberSet.has(id))
        // Nest if every member already lives in one existing tuplet.
        const parent = measure.tuplets?.find(t => orderedIds.every(id => t.memberIds.includes(id)))
        measure.tuplets ??= []
        measure.tuplets.push({
          id: crypto.randomUUID(),
          played: action.played,
          inSpaceOf: action.inSpaceOf,
          memberIds: orderedIds,
          parentId: parent?.id,
        })
        break
      }
      case 'REMOVE_TUPLET': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure?.tuplets) {
          // Re-parent children of the removed tuplet to its own parent so nesting stays valid.
          const removed = measure.tuplets.find(t => t.id === action.tupletId)
          measure.tuplets = measure.tuplets
            .filter(t => t.id !== action.tupletId)
            .map(t => (t.parentId === action.tupletId ? { ...t, parentId: removed?.parentId } : t))
          if (measure.tuplets.length === 0) measure.tuplets = undefined
        }
        break
      }
      case 'PLACE_TUPLET_NOTE': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (!measure || action.played < 2 || action.inSpaceOf < 1) break
        const { voice } = action
        const placed: NoteEvent = action.pitches
          ? { id: action.noteId, type: 'note', pitches: action.pitches, duration: action.duration, dots: action.dots, tied: false, voice, articulations: action.articulations }
          : { id: action.noteId, type: 'rest', duration: action.duration, dots: action.dots, voice, articulations: action.articulations }
        const W = noteBeatDuration(placed)

        // Resolve the target tuplet + the slot to start filling at. A click on a reserved
        // placeholder rest (`targetRestId`) fills that exact slot; otherwise reserve a fresh tuplet
        // at the cursor and fill its first slot. Placement never auto-flows onto committed notes/
        // rests — only reserved placeholder slots are fillable — so unclicked slots stay rests.
        let target: Tuplet | undefined
        let startPos: number
        if (action.targetRestId) {
          target = (measure.tuplets ?? []).find(t => t.placeholderIds?.includes(action.targetRestId!))
          if (!target) break
          startPos = target.memberIds.indexOf(action.targetRestId)
        } else {
          // Reserve a fresh tuplet of `played` rests of the base unit at the cursor. The base unit
          // (one slot) is the derived `baseDuration`/`baseDots`, independent of the placed value.
          const U = noteBeatDuration({ duration: action.baseDuration, dots: action.baseDots })
          const ts = effectiveTimeSig(draft, measure)
          if (action.inSpaceOf * U > measureRemainingBeats(measure, ts, voice) + 0.001) break
          const rests: Rest[] = Array.from({ length: action.played }, () => ({
            id: crypto.randomUUID(), type: 'rest', duration: action.baseDuration, dots: action.baseDots, voice,
          }))
          // Translate the voice-local atIndex to a measure.notes splice index.
          let count = 0
          let spliceAt = measure.notes.length
          for (let i = 0; i < measure.notes.length; i++) {
            if (measure.notes[i].voice === voice) { if (count === action.atIndex) { spliceAt = i; break }; count++ }
          }
          measure.notes.splice(spliceAt, 0, ...rests)
          const ids = rests.map(r => r.id)
          target = { id: crypto.randomUUID(), played: action.played, inSpaceOf: action.inSpaceOf, memberIds: ids, placeholderIds: [...ids] }
          measure.tuplets ??= []
          measure.tuplets.push(target)
          startPos = 0
        }
        if (startPos < 0) break

        // Consume placeholder space starting at `startPos`: walk contiguous placeholder slots
        // until they cover the placed event's written length `W`. A note larger than one slot
        // eats several whole slots; a note smaller than a slot splits it, the leftover re-reserved
        // as placeholder rest(s) so finer values fill the rest of that slot.
        const placeholders = new Set(target.placeholderIds ?? [])
        let acc = 0
        const consumed: string[] = []
        for (let i = startPos; i < target.memberIds.length && acc < W - 1e-6; i++) {
          const id = target.memberIds[i]
          if (!placeholders.has(id)) break // hit a committed slot — placed event won't fit here
          const slot = measure.notes.find(n => n.id === id)
          if (!slot) break
          acc += noteBeatDuration(slot)
          consumed.push(id)
        }
        if (consumed.length === 0 || acc < W - 1e-6) break // not enough open space at this slot
        const leftover = decomposeRests(acc - W, voice) // re-reserve the unused tail of the last slot

        // Replace the first consumed slot with the placed event, insert leftover rests after it,
        // and drop the remaining consumed placeholders.
        const replaceIdx = measure.notes.findIndex(n => n.id === consumed[0])
        measure.notes[replaceIdx] = placed
        if (leftover.length) measure.notes.splice(replaceIdx + 1, 0, ...leftover)
        const dropIds = new Set(consumed.slice(1))
        measure.notes = measure.notes.filter(n => !dropIds.has(n.id))
        target.memberIds.splice(startPos, consumed.length, action.noteId, ...leftover.map(r => r.id))
        // Consumed slots are now committed; the placed id is not a placeholder, but the leftover is.
        target.placeholderIds = (target.placeholderIds ?? [])
          .filter(id => !consumed.includes(id))
          .concat(leftover.map(r => r.id))
        break
      }
      case 'ADD_MEASURE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          const nextNum = (part.measures.at(-1)?.number ?? 0) + 1
          part.measures.push(createDefaultMeasure(nextNum))
        }
        break
      }
      case 'ADD_MEASURES': {
        // Append `count` measures to every part so all tracks stay barline-aligned.
        const count = Math.max(1, Math.floor(action.count))
        for (const part of draft.parts) {
          let nextNum = (part.measures.at(-1)?.number ?? 0) + 1
          for (let i = 0; i < count; i++) part.measures.push(createDefaultMeasure(nextNum++))
        }
        break
      }
      case 'INSERT_MEASURES': {
        // Insert `count` blank measures before measure number `at` in every part, then
        // renumber so barlines stay aligned. Time/key-sig overrides ride along with their
        // own measure objects, so an insert never displaces a mid-score signature change.
        const count = Math.max(1, Math.floor(action.count))
        for (const part of draft.parts) {
          // Clamp insertion index to [0, length]; `at` beyond the end appends.
          const idx = Math.max(0, Math.min(part.measures.length, action.at - 1))
          const fresh = Array.from({ length: count }, () => createDefaultMeasure(0))
          part.measures.splice(idx, 0, ...fresh)
          renumberMeasures(part)
        }
        // Shift score-level tempo changes at/after the insertion point forward.
        for (const tc of draft.tempoChanges) {
          if (tc.measureNumber >= action.at) tc.measureNumber += count
        }
        break
      }
      case 'REMOVE_MEASURES': {
        // Remove the inclusive range of measure numbers [start, end] from every part,
        // drop ties touching removed notes, then renumber the survivors.
        const start = Math.max(1, Math.floor(action.start))
        const end = Math.floor(action.end)
        if (end < start) break
        for (const part of draft.parts) {
          const removed = part.measures.filter(m => m.number >= start && m.number <= end)
          if (removed.length === 0) continue
          part.measures = part.measures.filter(m => m.number < start || m.number > end)
          // Never leave a part with zero measures.
          if (part.measures.length === 0) part.measures.push(createDefaultMeasure(0))
          if (part.ties) {
            const goneIds = new Set(removed.flatMap(m => m.notes.map(n => n.id)))
            part.ties = part.ties.filter(t => !goneIds.has(t.from.note) && !goneIds.has(t.to.note))
          }
          renumberMeasures(part)
        }
        // Drop tempo changes in the removed range; shift later ones back.
        const span = end - start + 1
        draft.tempoChanges = draft.tempoChanges
          .filter(tc => tc.measureNumber < start || tc.measureNumber > end)
          .map(tc => tc.measureNumber > end ? { ...tc, measureNumber: tc.measureNumber - span } : tc)
        break
      }
      case 'DELETE_MEASURE': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          const removed = part.measures.find(m => m.id === action.measureId)
          part.measures = part.measures.filter(m => m.id !== action.measureId)
          if (removed && part.ties) {
            const goneIds = new Set(removed.notes.map(n => n.id))
            part.ties = part.ties.filter(t => !goneIds.has(t.from.note) && !goneIds.has(t.to.note))
          }
        }
        break
      }
      case 'SET_TIME_SIG': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) measure.timeSig = action.timeSig
        break
      }
      case 'SET_KEY_SIG': {
        const measure = draft.parts
          .find(p => p.id === action.partId)
          ?.measures.find(m => m.id === action.measureId)
        if (measure) measure.keySig = action.keySig
        break
      }
      case 'SET_SCORE_TIME_SIG_AT': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.timeSig = action.timeSig
        }
        break
      }
      case 'SET_SCORE_KEY_SIG_AT': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.keySig = action.keySig
        }
        break
      }
      case 'CLEAR_MEASURE_KEY_SIG': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.keySig = undefined
        }
        break
      }
      case 'CLEAR_MEASURE_TIME_SIG': {
        for (const part of draft.parts) {
          const measure = part.measures.find(m => m.number === action.measureNumber)
          if (measure) measure.timeSig = undefined
        }
        break
      }
      case 'SET_GLOBAL_TIME_SIG': {
        draft.globalTimeSig = action.timeSig
        break
      }
      case 'SET_GLOBAL_KEY_SIG': {
        draft.globalKeySig = action.keySig
        break
      }
      case 'SET_TEMPO': {
        draft.tempo = action.tempo
        break
      }
      case 'SET_MEASURE_TEMPO': {
        const existing = draft.tempoChanges.findIndex(tc => tc.measureNumber === action.measureNumber)
        if (existing !== -1) {
          draft.tempoChanges[existing].tempo = action.tempo
        } else {
          draft.tempoChanges.push({ measureNumber: action.measureNumber, tempo: action.tempo })
          draft.tempoChanges.sort((a, b) => a.measureNumber - b.measureNumber)
        }
        break
      }
      case 'REMOVE_MEASURE_TEMPO': {
        draft.tempoChanges = draft.tempoChanges.filter(tc => tc.measureNumber !== action.measureNumber)
        break
      }
      case 'SET_TITLE': {
        draft.title = action.title
        break
      }
      case 'ADD_PART': {
        draft.parts.push({
          id: crypto.randomUUID(),
          name: action.name,
          instrument: action.instrument,
          clef: action.clef,
          measures: createInheritedMeasures(draft, getMeasureCount(draft) || 4),
        })
        break
      }
      case 'ADD_PIANO_PART': {
        const trebleId = crypto.randomUUID()
        const bassId = crypto.randomUUID()
        const count = getMeasureCount(draft) || 4
        draft.parts.push({
          id: trebleId,
          name: 'Piano (Treble)',
          instrument: 'piano',
          clef: 'treble',
          measures: createInheritedMeasures(draft, count),
          grandStaffPartnerId: bassId,
        })
        draft.parts.push({
          id: bassId,
          name: 'Piano (Bass)',
          instrument: 'piano_bass',
          clef: 'bass',
          measures: createInheritedMeasures(draft, count),
          grandStaffPartnerId: trebleId,
        })
        break
      }
      case 'REMOVE_PART': {
        const part = draft.parts.find(p => p.id === action.partId)
        // If this is a grand staff part, also remove the partner.
        const partnerId = part?.grandStaffPartnerId
        draft.parts = draft.parts.filter(p => p.id !== action.partId && p.id !== partnerId)
        break
      }
      case 'SET_PART_INSTRUMENT': {
        const part = draft.parts.find(p => p.id === action.partId)
        if (part) {
          part.instrument = action.instrument
          part.name = INSTRUMENT_DB[action.instrument]?.displayName ?? action.instrument
        }
        break
      }
      // UNDO/REDO handled in useUndoRedo hook — no-op here
      case 'UNDO':
      case 'REDO':
      case 'COMMIT_AI_SUGGESTION':
        break
    }
  })
}

export { pitchArraysEqual }

function getMeasureCount(score: Score): number {
  return Math.max(0, ...score.parts.map(p => p.measures.length))
}

// Re-stamp a part's measures with sequential 1-based numbers after an insert/remove.
function renumberMeasures(part: Part): void {
  part.measures.forEach((m, i) => { m.number = i + 1 })
}

function effectiveTimeSig(score: Score, measure: Measure): TimeSig {
  // A time-sig change propagates forward until the next change, so a measure without
  // its own override inherits from the most recent one in its part (else the global sig).
  for (const part of score.parts) {
    const idx = part.measures.indexOf(measure)
    if (idx !== -1) return effectiveTimeSigAt(part.measures, idx, score.globalTimeSig)
  }
  return measure.timeSig ?? score.globalTimeSig
}
