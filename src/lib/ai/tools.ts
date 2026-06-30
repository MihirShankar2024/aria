import type Anthropic from '@anthropic-ai/sdk'

// Claude tool definitions = the Phase 0 editing vocabulary + the read-only analysis "ears".
// Args are SEMANTIC (ids, pitch by step/octave/accidental, duration, voice, anchor) — the same
// shape `commands.*` consumes. The executor validates each call through the command layer, so a
// bad call is rejected, not corrupted.

const DURATION = { type: 'string', enum: ['whole', 'half', 'quarter', 'eighth', 'sixteenth'] }
const DOTS = { type: 'integer', enum: [0, 1] }
const VOICE = { type: 'integer', enum: [1, 2] }
const PITCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    step: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    octave: { type: 'integer' },
    accidental: { type: ['string', 'null'], enum: ['sharp', 'flat', 'natural', 'double_sharp', 'double_flat', null] },
  },
  required: ['step', 'octave', 'accidental'],
}
const ANCHOR = {
  type: 'object',
  additionalProperties: false,
  description: "append = add at end of the voice in this measure; near = chord-onto/insert-after/replace this event id",
  properties: { kind: { type: 'string', enum: ['append', 'near'] }, eventId: { type: 'string' } },
  required: ['kind'],
}
const ARTICULATION = { type: 'string', enum: ['staccato', 'tenuto', 'fermata', 'accent', 'marcato', 'spiccato', 'upBow', 'downBow', 'lhPizz', 'snapPizz', 'open'] }

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Messages.Tool {
  return { name, description, input_schema: { type: 'object', additionalProperties: false, properties, required } as Anthropic.Messages.Tool.InputSchema }
}

export const AI_TOOLS: Anthropic.Messages.Tool[] = [
  // ── entry ──
  tool('placeNote', "Place a note. Same duration as a near note chords; different duration inserts after; near a rest replaces it; append adds at the end. For transposing instruments, set pitchSpace:'written' to give a written pitch (default 'concert').",
    { partId: { type: 'string' }, measureId: { type: 'string' }, pitch: PITCH, duration: DURATION, dots: DOTS, voice: VOICE, anchor: ANCHOR, articulation: ARTICULATION, pitchSpace: { type: 'string', enum: ['concert', 'written'] } },
    ['partId', 'measureId', 'pitch', 'duration', 'dots', 'voice', 'anchor']),
  tool('placeRest', 'Place a rest. Near a note replaces it with a rest; append adds at the end.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, duration: DURATION, dots: DOTS, voice: VOICE, anchor: ANCHOR },
    ['partId', 'measureId', 'duration', 'dots', 'voice', 'anchor']),
  tool('replaceWithRest', 'Turn an existing event into a rest.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, eventId: { type: 'string' }, duration: DURATION, dots: DOTS, voice: VOICE },
    ['partId', 'measureId', 'eventId', 'duration', 'dots', 'voice']),
  tool('addChordNote', "Add a pitch onto an existing note (make/extend a chord). pitchSpace:'written' for transposing instruments.",
    { partId: { type: 'string' }, measureId: { type: 'string' }, noteId: { type: 'string' }, pitch: PITCH, articulation: ARTICULATION, pitchSpace: { type: 'string', enum: ['concert', 'written'] } },
    ['partId', 'measureId', 'noteId', 'pitch']),
  tool('removeChordNote', 'Remove one pitch from a chord (not the last tone).',
    { partId: { type: 'string' }, measureId: { type: 'string' }, noteId: { type: 'string' }, pitch: PITCH },
    ['partId', 'measureId', 'noteId', 'pitch']),
  tool('deleteEvent', 'Delete an event.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, noteId: { type: 'string' } },
    ['partId', 'measureId', 'noteId']),
  // ── voices ──
  tool('setEventVoice', 'Move an event to the other voice (1<->2) if it fits.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, eventId: { type: 'string' }, toVoice: VOICE },
    ['partId', 'measureId', 'eventId', 'toVoice']),
  tool('clearVoice', 'Delete all events of a voice in a measure.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, voice: VOICE },
    ['partId', 'measureId', 'voice']),
  // ── connections & markings ──
  tool('addSlurOrTie', 'Connect two noteheads with a tie (same pitch) or slur (different pitch). Use Pitch.id values from the snapshot.',
    { partId: { type: 'string' }, fromNoteId: { type: 'string' }, fromPitchId: { type: 'string' }, toNoteId: { type: 'string' }, toPitchId: { type: 'string' } },
    ['partId', 'fromNoteId', 'fromPitchId', 'toNoteId', 'toPitchId']),
  tool('removeTie', 'Remove a tie/slur by id.',
    { partId: { type: 'string' }, tieId: { type: 'string' } }, ['partId', 'tieId']),
  tool('setArticulation', 'Add or remove an articulation on an event.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, noteId: { type: 'string' }, articulation: ARTICULATION, on: { type: 'boolean' } },
    ['partId', 'measureId', 'noteId', 'articulation', 'on']),
  tool('addMarking', "Add a marking to a measure: a dynamic/ornament by symbolId (e.g. 'dyn.mf', 'orn.trill'), or free text. Anchors to the measure.",
    { partId: { type: 'string' }, measureId: { type: 'string' }, symbolId: { type: 'string' }, text: { type: 'string' }, dx: { type: 'number' }, dy: { type: 'number' } },
    ['partId', 'measureId']),
  // ── tuplets ──
  tool('createTuplet', 'Group contiguous same-voice events into a tuplet (e.g. played 3 in space of 2).',
    { partId: { type: 'string' }, measureId: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } }, played: { type: 'integer' }, inSpaceOf: { type: 'integer' } },
    ['partId', 'measureId', 'memberIds', 'played', 'inSpaceOf']),
  tool('removeTuplet', 'Remove a tuplet group by id.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, tupletId: { type: 'string' } },
    ['partId', 'measureId', 'tupletId']),
  tool('placeTupletNote', 'Enter a note (omit pitch for a rest) into a tuplet, e.g. write a triplet. played:inSpaceOf is the ratio (3:2 = triplet); baseDuration/baseDots = the tuplet unit; duration/dots = this event; atIndex = voice-local position; targetRestId optional to fill a reserved slot.',
    { partId: { type: 'string' }, measureId: { type: 'string' }, voice: VOICE, played: { type: 'integer' }, inSpaceOf: { type: 'integer' }, baseDuration: DURATION, baseDots: DOTS, duration: DURATION, dots: DOTS, pitch: PITCH, atIndex: { type: 'integer' }, targetRestId: { type: 'string' } },
    ['partId', 'measureId', 'voice', 'played', 'inSpaceOf', 'baseDuration', 'baseDots', 'duration', 'dots', 'atIndex']),
  // ── structure & globals ──
  tool('addMeasures', 'Append measures at the end.', { count: { type: 'integer' } }, ['count']),
  tool('insertMeasures', 'Insert measures before measure number `at` (1-based).', { count: { type: 'integer' }, at: { type: 'integer' } }, ['count', 'at']),
  tool('removeMeasures', 'Remove the inclusive measure-number range [start, end].', { start: { type: 'integer' }, end: { type: 'integer' } }, ['start', 'end']),
  tool('setTimeSig', 'Set time signature globally, or at a measure number with `at`.', { beats: { type: 'integer' }, beatType: { type: 'integer' }, at: { type: 'integer' } }, ['beats', 'beatType']),
  tool('setKeySig', 'Set key signature globally, or at a measure number with `at`. fifths -7..7.', { fifths: { type: 'integer' }, mode: { type: 'string', enum: ['major', 'minor'] }, at: { type: 'integer' } }, ['fifths', 'mode']),
  tool('setTempo', 'Set tempo (BPM) globally, or at a measure number with `at`.', { tempo: { type: 'number' }, at: { type: 'integer' } }, ['tempo']),
  tool('setTitle', 'Set the score title.', { title: { type: 'string' } }, ['title']),
  tool('addPart', 'Add an instrument part.', { name: { type: 'string' }, instrument: { type: 'string' }, clef: { type: 'string', enum: ['treble', 'bass', 'alto'] } }, ['name', 'instrument', 'clef']),
  tool('addPianoPart', 'Add a grand-staff piano part.', {}, []),
  tool('setPartInstrument', 'Change a part instrument.', { partId: { type: 'string' }, instrument: { type: 'string' } }, ['partId', 'instrument']),
  // ── interactive ──
  tool('askUser', 'Ask the user to choose or confirm, shown inline as a clickable question box. Use this instead of asking in prose and waiting for a new message. Provide options for quick answers; set multiSelect for "pick any". The user may also type a custom answer.', { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, multiSelect: { type: 'boolean' } }, ['question']),
  // ── read-only ──
  tool('listMarkings', 'List valid marking symbolIds (dynamics/ornaments/symbols/text) for addMarking, so you use a real id instead of guessing.', {}, []),
  tool('getMeasures', 'Read full note detail for a measure-number range (use on large scores to inspect bars outside the focus window before editing them).', { fromMeasure: { type: 'integer' }, toMeasure: { type: 'integer' }, partId: { type: 'string' } }, ['fromMeasure', 'toMeasure']),
  // ── read-only analysis (the "ears") ──
  tool('getSoundingTimeline', 'Read the resolved sounding pitches: vertical sonorities + per-voice lines over a measure range.', { fromMeasure: { type: 'integer' }, toMeasure: { type: 'integer' } }, []),
  tool('analyzeHarmony', 'Identify chords, Roman numerals vs the key, and non-chord tones over a measure range.', { fromMeasure: { type: 'integer' }, toMeasure: { type: 'integer' } }, []),
  tool('findDissonances', 'Find harsh intervals (minor 2nd, major 7th, tritone) with note locations.', { fromMeasure: { type: 'integer' }, toMeasure: { type: 'integer' } }, []),
  tool('checkVoiceLeading', 'Detect parallel fifths/octaves, large leaps, and out-of-key notes.', { fromMeasure: { type: 'integer' }, toMeasure: { type: 'integer' } }, []),
]

/** Tool names that mutate the score (go through the approve gate). Everything else is read-only. */
export const EDIT_TOOLS = new Set([
  'placeNote', 'placeRest', 'replaceWithRest', 'addChordNote', 'removeChordNote', 'deleteEvent',
  'setEventVoice', 'clearVoice', 'addSlurOrTie', 'removeTie', 'setArticulation', 'addMarking',
  'createTuplet', 'removeTuplet', 'placeTupletNote', 'addMeasures', 'insertMeasures', 'removeMeasures',
  'setTimeSig', 'setKeySig', 'setTempo', 'setTitle', 'addPart', 'addPianoPart', 'setPartInstrument',
])
