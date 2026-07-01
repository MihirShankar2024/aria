import type { Score, NoteEvent, Annotation } from '../../types/score'
import { getInstrument } from '../instruments'

/** Semitone transposition of a part's instrument (0 for non-transposing); included so the model
 *  knows when to use pitchSpace:'written'. */
function transpositionOf(instrument: string): number {
  return getInstrument(instrument).transposition
}

/** What the user currently has selected/targeted, so the model knows where to act by default. */
export interface AiSelection {
  partIds: string[]
  measureNumbers: number[]
  noteIds: string[]
  /** The keyboard cursor (insertion point), for resolving "here" when nothing is selected. */
  cursor?: { partId: string; measureNumber: number; eventId?: string }
}

// Compact AI-facing projections. We send the NATIVE structure with stable ids (so the model can
// target events precisely) — NOT a lossy MusicXML export. Manual-placement fields (GlyphOffset,
// TieCurveOverride, annotation pixel anchors) are deliberately omitted: the AI must never set them.

// Compact: fields at their default are OMITTED to save tokens (the model is told the defaults in the
// system prompt). Defaults — dots: 0, voice: 1, accidental: null, tied: false, no articulations.
interface AiEvent {
  id: string
  kind: 'note' | 'rest'
  voice?: 1 | 2
  duration: string
  dots?: number
  pitches?: { id: string; step: string; octave: number; accidental?: string }[]
  tied?: boolean
  articulations?: string[]
}

function projectEvent(e: NoteEvent): AiEvent {
  const base: AiEvent = { id: e.id, kind: e.type, duration: e.duration }
  if (e.voice !== 1) base.voice = e.voice
  if (e.dots) base.dots = e.dots
  if (e.articulations?.length) base.articulations = e.articulations.map(a => a.type)
  if (e.type === 'note') {
    base.pitches = e.pitches.map(p => p.accidental ? { id: p.id, step: p.step, octave: p.octave, accidental: p.accidental } : { id: p.id, step: p.step, octave: p.octave })
    if (e.tied) base.tied = true
  }
  return base
}

function projectAnnotation(a: Annotation): Record<string, unknown> {
  switch (a.kind) {
    case 'glyph': return { id: a.id, kind: 'glyph', symbolId: a.symbolId, measureId: a.anchor.measureId }
    case 'line': return { id: a.id, kind: 'line', lineType: a.lineType, measureId: a.anchor.measureId }
    case 'text': return { id: a.id, kind: 'text', text: a.text, measureId: a.anchor.measureId }
    case 'measureNumber': return { id: a.id, kind: 'measureNumber', measureId: a.anchor.measureId }
  }
}

function projectMeasure(m: import('../../types/score').Measure) {
  return {
    number: m.number,
    id: m.id,
    ...(m.timeSig ? { timeSig: m.timeSig } : {}),
    ...(m.keySig ? { keySig: m.keySig } : {}),
    notes: m.notes.map(projectEvent),
    ...(m.tuplets?.length ? { tuplets: m.tuplets.map(t => ({ id: t.id, played: t.played, inSpaceOf: t.inSpaceOf, memberIds: t.memberIds })) } : {}),
  }
}

const FULL_THRESHOLD = 20   // measures: send the whole score in full detail at or below this.
const FOCUS_PAD = 2         // bars of context on each side of the focus region.

export interface ScoreViewOpts {
  /** When nothing is selected, focus here (e.g. the last-edited region). 1-based measure numbers. */
  focusMeasures?: number[]
  /** Which pitch space the user is LOOKING at. 'written' = transposed view is on, so the AI should
   *  talk to the user in written pitch for transposing parts (the snapshot itself stays concert). */
  pitchDisplay?: 'concert' | 'written'
}

/**
 * Project the live `Score` into the compact JSON the model reads (VOLATILE — user message, not the
 * cached system prompt). Adaptive by size: small scores are sent in full; large scores send a
 * structural INDEX (parts + per-measure sig/key changes) plus full detail only for a FOCUS WINDOW
 * (selection ± context). The model calls `getMeasures` to read other bars on demand.
 */
export function scoreForAi(score: Score, selection: AiSelection, opts?: ScoreViewOpts): string {
  const measureCount = Math.max(0, ...score.parts.map(p => p.measures.length))
  const head = { title: score.title, tempo: score.tempo, globalTimeSig: score.globalTimeSig, globalKeySig: score.globalKeySig, tempoChanges: score.tempoChanges, pitchDisplay: opts?.pitchDisplay ?? 'concert' }

  if (measureCount <= FULL_THRESHOLD) {
    return JSON.stringify({
      ...head,
      parts: score.parts.map(part => ({
        id: part.id, name: part.name, instrument: part.instrument, clef: part.clef, grandStaffPartnerId: part.grandStaffPartnerId,
        ...(transpositionOf(part.instrument) ? { transposition: transpositionOf(part.instrument) } : {}),
        measures: part.measures.map(projectMeasure),
        ties: (part.ties ?? []).map(t => ({ id: t.id, from: t.from, to: t.to })),
        annotations: (part.annotations ?? []).map(projectAnnotation),
      })),
      selection,
    })
  }

  // Large score: index + focus window.
  const focusSeed = selection.measureNumbers.length ? selection.measureNumbers
    : opts?.focusMeasures?.length ? opts.focusMeasures
    : [1, 2, 3, 4]
  const lo = Math.max(1, Math.min(...focusSeed) - FOCUS_PAD)
  const hi = Math.min(measureCount, Math.max(...focusSeed) + FOCUS_PAD)

  return JSON.stringify({
    ...head,
    view: 'scoped',
    note: `Large score: you see a structural index + full detail for bars ${lo}–${hi}. Call getMeasures(fromMeasure,toMeasure) to read other bars before editing them.`,
    focusWindow: { fromMeasure: lo, toMeasure: hi },
    parts: score.parts.map(part => ({
      id: part.id, name: part.name, instrument: part.instrument, clef: part.clef, grandStaffPartnerId: part.grandStaffPartnerId,
      ...(transpositionOf(part.instrument) ? { transposition: transpositionOf(part.instrument) } : {}),
      measureCount: part.measures.length,
      // per-measure changes only (sig/key) — gives the model the structure without every note.
      changes: part.measures.filter(m => m.timeSig || m.keySig).map(m => ({ number: m.number, ...(m.timeSig ? { timeSig: m.timeSig } : {}), ...(m.keySig ? { keySig: m.keySig } : {}) })),
      measures: part.measures.filter(m => m.number >= lo && m.number <= hi).map(projectMeasure),
      ties: (part.ties ?? []).map(t => ({ id: t.id, from: t.from, to: t.to })),
      annotations: (part.annotations ?? []).map(projectAnnotation),
    })),
    selection,
  })
}

/**
 * Project a single measure by id from the (working) score, so an edit tool can echo the bar's
 * resulting content back to the model. Without this, the model only sees the original snapshot plus
 * terse {ok, placedId} results across a multi-turn edit — so it can't tell a bar it already wrote is
 * now full, and re-places into it (notes get cloned; the second pass overflows). Returns null if the
 * part/measure is gone.
 */
export function projectMeasureById(score: Score, partId: string, measureId: string) {
  const measure = score.parts.find(p => p.id === partId)?.measures.find(m => m.id === measureId)
  return measure ? projectMeasure(measure) : null
}

/** Full detail for a measure-number range (the `getMeasures` read tool). */
export function projectMeasures(score: Score, fromMeasure: number, toMeasure: number, partId?: string) {
  return {
    parts: score.parts.filter(p => !partId || p.id === partId).map(part => ({
      id: part.id, name: part.name,
      measures: part.measures.filter(m => m.number >= fromMeasure && m.number <= toMeasure).map(projectMeasure),
    })),
  }
}
