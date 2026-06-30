import type { Score, VoiceNumber } from '../../types/score'
import type { ScoreAction } from '../../state/actions'
import type { PartContext, CommandResult } from '../editing/types'
import * as cmd from '../editing/commands'
import { findCatalogEntry, ANNOTATION_CATALOG } from '../annotations/catalog'
import { getInstrument } from '../instruments'
import { writtenPitchToConcert } from '../transposition/transpose'
import { buildAnnotation } from '../../components/editor/annotationSpawn'
import { EDIT_TOOLS } from './tools'
import { projectMeasures } from './serializeForAi'
import { getSoundingTimeline, analyzeHarmony, findDissonances, checkVoiceLeading } from './analysis'

/**
 * Runs a single Claude tool call. EDIT tools go through `commands.*`, and on success their actions
 * are STAGED (not dispatched) — the user approves the whole batch at the end. A rejection is
 * surfaced back to the model so it can adapt. READ tools run the analysis and return data.
 */
export interface ExecOutcome {
  isError: boolean
  result: unknown          // JSON-serialisable; becomes the tool_result content
  actions: ScoreAction[]   // staged edits (empty for reads / rejections)
}

function ctxFor(score: Score, partId: string): PartContext | null {
  const part = score.parts.find(p => p.id === partId)
  if (!part) return null
  return { partId, measures: part.measures, globalTimeSig: score.globalTimeSig }
}

function fromCommand(res: CommandResult): ExecOutcome {
  return res.ok
    ? { isError: false, result: { ok: true, placedId: res.placedId }, actions: res.actions }
    : { isError: true, result: { ok: false, ...res.rejection }, actions: [] }
}

const noPart = (partId: string): ExecOutcome => ({ isError: true, result: { ok: false, reason: 'not_found', what: 'part', id: partId }, actions: [] })

// Minimal typed views of tool inputs (validated structurally by the command layer downstream).
type In = Record<string, unknown>
const s = (v: unknown) => v as string
const n = (v: unknown) => v as number
const vn = (v: unknown) => v as VoiceNumber

export function executeToolCall(score: Score, name: string, input: In): ExecOutcome {
  // ── read-only ──
  switch (name) {
    case 'listMarkings': return { isError: false, result: { markings: ANNOTATION_CATALOG.flatMap(cat => cat.entries.map(e => ({ symbolId: e.symbolId, label: e.label, kind: e.spawn }))) }, actions: [] }
    case 'getMeasures': return { isError: false, result: projectMeasures(score, n(input.fromMeasure), n(input.toMeasure), input.partId as string | undefined), actions: [] }
    case 'getSoundingTimeline': return { isError: false, result: getSoundingTimeline(score, input), actions: [] }
    case 'analyzeHarmony': return { isError: false, result: analyzeHarmony(score, input), actions: [] }
    case 'findDissonances': return { isError: false, result: findDissonances(score, input), actions: [] }
    case 'checkVoiceLeading': return { isError: false, result: checkVoiceLeading(score, input), actions: [] }
  }

  // ── globals / structure (no part context needed) ──
  switch (name) {
    case 'addMeasures': return fromCommand(cmd.addMeasures(n(input.count)))
    case 'insertMeasures': return fromCommand(cmd.insertMeasures(n(input.count), n(input.at)))
    case 'removeMeasures': return fromCommand(cmd.removeMeasures(n(input.start), n(input.end)))
    case 'setTimeSig': return fromCommand(cmd.setTimeSig({ beats: n(input.beats), beatType: n(input.beatType) }, input.at as number | undefined))
    case 'setKeySig': return fromCommand(cmd.setKeySig({ fifths: n(input.fifths), mode: input.mode as 'major' | 'minor' }, input.at as number | undefined))
    case 'setTempo': return fromCommand(cmd.setTempo(n(input.tempo), input.at as number | undefined))
    case 'setTitle': return fromCommand(cmd.setTitle(s(input.title)))
    case 'addPart': return fromCommand(cmd.addPart(s(input.name), s(input.instrument), input.clef as 'treble' | 'bass' | 'alto'))
    case 'addPianoPart': return fromCommand(cmd.addPianoPart())
    case 'setPartInstrument': return fromCommand(cmd.setPartInstrument(s(input.partId), s(input.instrument)))
  }

  // ── per-part edits ──
  if (EDIT_TOOLS.has(name)) {
    const partId = s(input.partId)
    const ctx = ctxFor(score, partId)
    if (!ctx) return noPart(partId)
    const part = score.parts.find(p => p.id === partId)!
    // Build a concert Pitch from the model's {step,octave,accidental}, honoring an optional
    // pitchSpace:'written' for transposing instruments (convert via the existing util).
    const toConcertPitch = (raw: unknown): never => {
      const p = { id: crypto.randomUUID(), ...(raw as object) } as never
      const written = input.pitchSpace === 'written' && getInstrument(part.instrument).transposition !== 0
      return (written ? writtenPitchToConcert(p, part.instrument) : p) as never
    }
    switch (name) {
      case 'placeNote':
        return fromCommand(cmd.placeNote(ctx, {
          measureId: s(input.measureId), pitch: toConcertPitch(input.pitch),
          duration: input.duration as never, dots: n(input.dots) as 0 | 1, voice: vn(input.voice),
          anchor: input.anchor as never,
          articulations: input.articulation ? [{ type: input.articulation as never }] : undefined,
        }))
      case 'placeRest':
        return fromCommand(cmd.placeRest(ctx, {
          measureId: s(input.measureId), duration: input.duration as never, dots: n(input.dots) as 0 | 1,
          voice: vn(input.voice), anchor: input.anchor as never,
        }))
      case 'replaceWithRest':
        return fromCommand(cmd.replaceWithRest(ctx, s(input.measureId), s(input.eventId), input.duration as never, n(input.dots) as 0 | 1, vn(input.voice)))
      case 'addChordNote':
        return fromCommand(cmd.addChordNote(ctx, s(input.measureId), s(input.noteId), toConcertPitch(input.pitch), input.articulation as never))
      case 'removeChordNote':
        return fromCommand(cmd.removeChordNote(ctx, s(input.measureId), s(input.noteId), input.pitch as never))
      case 'deleteEvent':
        return fromCommand(cmd.deleteEvent(ctx, s(input.measureId), s(input.noteId)))
      case 'setEventVoice':
        return fromCommand(cmd.setEventVoice(ctx, s(input.measureId), s(input.eventId), vn(input.toVoice)))
      case 'clearVoice':
        return fromCommand(cmd.clearVoice(ctx, s(input.measureId), vn(input.voice)))
      case 'addSlurOrTie':
        return fromCommand(cmd.addSlurOrTie(ctx, s(input.fromNoteId), s(input.fromPitchId), s(input.toNoteId), s(input.toPitchId)))
      case 'removeTie':
        return fromCommand(cmd.removeTie(ctx, s(input.tieId)))
      case 'setArticulation':
        return fromCommand(cmd.setArticulation(ctx, s(input.measureId), s(input.noteId), input.articulation as never, input.on as boolean))
      case 'createTuplet':
        return fromCommand(cmd.createTuplet(ctx, s(input.measureId), input.memberIds as string[], n(input.played), n(input.inSpaceOf)))
      case 'removeTuplet':
        return fromCommand(cmd.removeTuplet(ctx, s(input.measureId), s(input.tupletId)))
      case 'placeTupletNote':
        return fromCommand(cmd.placeTupletNote(ctx, {
          measureId: s(input.measureId), voice: vn(input.voice),
          played: n(input.played), inSpaceOf: n(input.inSpaceOf), baseDuration: input.baseDuration as never, baseDots: n(input.baseDots),
          duration: input.duration as never, dots: n(input.dots) as 0 | 1,
          pitch: input.pitch ? toConcertPitch(input.pitch) : null, atIndex: n(input.atIndex), targetRestId: input.targetRestId as string | undefined,
        }))
      case 'addMarking': {
        const dx = (input.dx as number | undefined) ?? 16
        const dy = (input.dy as number | undefined) ?? 56
        if (input.symbolId) {
          const entry = findCatalogEntry(s(input.symbolId))
          if (!entry) return { isError: true, result: { ok: false, reason: 'invalid_arg', detail: `unknown symbolId ${input.symbolId}` }, actions: [] }
          const { annotation } = buildAnnotation(entry, s(input.measureId), dx, dy)
          return fromCommand(cmd.addMarking(ctx, annotation))
        }
        if (input.text != null) {
          const entry = { symbolId: 'text.custom', label: 'text', spawn: 'text' as const, text: s(input.text), previewFont: 'text' as const }
          const { annotation } = buildAnnotation(entry, s(input.measureId), dx, dy)
          return fromCommand(cmd.addMarking(ctx, annotation))
        }
        return { isError: true, result: { ok: false, reason: 'invalid_arg', detail: 'addMarking needs symbolId or text' }, actions: [] }
      }
    }
  }

  return { isError: true, result: { ok: false, reason: 'invalid_arg', detail: `unknown tool ${name}` }, actions: [] }
}
