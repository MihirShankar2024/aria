import type { Annotation } from '../../types/score'

/**
 * Auto-placement engine for AI-created marks.
 *
 * The AI never chooses pixel positions — it picks a measure (and, for note-anchored marks, a target
 * event) and the mark carries `anchor.auto = true`. At render time this module decides WHERE the mark
 * goes from two inputs: (1) a per-type routing switch (`placementRuleFor`) that maps a mark's symbolId
 * to a horizontal anchor + vertical zone, and (2) the real note geometry of the measure. A final
 * stacking pass (`layoutMeasureMarks`) offsets marks that would overlap so nothing collides.
 *
 * Coordinates match the AnnotationsLayer: x is absolute SVG px, y is absolute SVG px; a mark's (x, y)
 * is its CENTER (the layer renders with translate(-50%, -50%)). Larger y = lower on screen.
 *
 * Dragging an auto mark bakes concrete dx/dy and clears `auto`, turning it into a normal manual mark.
 */

// ── routing vocabulary ───────────────────────────────────────────────────────

/** Horizontal anchor for a mark. */
export type HAnchor =
  | 'measureStart'   // just after the clef/key/time sig (measure content start)
  | 'measureCenter'  // horizontal center of the note area
  | 'measureEnd'     // right edge of the measure
  | 'event'          // the target event's x (a specific beat)
  | 'eventHead'      // centered over the target note's head
  | 'eventLeft'      // just left of the target note (grace notes, arpeggio)

/** Vertical zone for a mark. `above`/`below` marks participate in outward stacking. */
export type VZone =
  | 'aboveStaff'     // above the top staff line (tempo, rehearsal, navigation symbols)
  | 'aboveNotes'     // above the highest note (text, ornaments over a note)
  | 'belowNotes'     // below the lowest note (dynamics, sforzando)
  | 'onStem'         // on the note's stem (tremolo)
  | 'onNote'         // at the note itself (grace, arpeggio)
  | 'staffCenter'    // vertical middle of the staff (repeat signs)

export interface PlacementRule {
  h: HAnchor
  v: VZone
  /** below-zone marks that should flip ABOVE when the below slot is already taken (dynamics). */
  flipIfBelowOccupied?: boolean
  /** two-endpoint line marks (gliss, trill extension) resolved from a start + end event. */
  twoEnd?: boolean
  /** scale the glyph down to fit its slot when oversized (large symbols). */
  scaleToFit?: boolean
}

const SFORZANDO = new Set(['sf', 'sfz', 'sffz', 'sfzp', 'fz', 'fp', 'rf', 'rfz'])

/** The switch: map an annotation to its placement rule. Pure — unit tested. */
export function placementRuleFor(ann: Annotation): PlacementRule {
  if (ann.kind === 'measureNumber') return { h: 'measureStart', v: 'aboveStaff' }

  if (ann.kind === 'text') {
    if (ann.symbolId === 'text.tempo') return { h: 'measureStart', v: 'aboveStaff' }
    if (ann.symbolId?.startsWith('sym.')) return { h: 'measureStart', v: 'aboveStaff' } // D.S./D.C.
    return { h: 'measureStart', v: 'aboveNotes' }
  }

  if (ann.kind === 'line') {
    if (ann.lineType === 'gliss' || ann.lineType === 'trillExt') return { h: 'eventHead', v: 'aboveNotes', twoEnd: true }
    // hairpins / pedal below; octave lines / endings above.
    if (ann.lineType === 'cresc' || ann.lineType === 'decresc' || ann.lineType === 'pedalBracket') return { h: 'measureStart', v: 'belowNotes', twoEnd: true }
    return { h: 'measureStart', v: 'aboveStaff', twoEnd: true }
  }

  // glyph — route by symbolId category.
  const id = ann.symbolId
  const sub = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id
  if (id.startsWith('dyn.')) {
    if (SFORZANDO.has(sub)) return { h: 'event', v: 'belowNotes', flipIfBelowOccupied: true }
    return { h: 'measureStart', v: 'belowNotes', flipIfBelowOccupied: true }
  }
  if (id.startsWith('orn.')) {
    if (sub === 'grace' || sub === 'appoggiatura' || sub === 'arpeggio') return { h: 'eventLeft', v: 'onNote' }
    if (sub.startsWith('tremolo')) return { h: 'event', v: 'onStem' }
    return { h: 'eventHead', v: 'aboveNotes' } // trill, mordent(s), turn(s), accidentals over an ornament
  }
  if (id.startsWith('sym.')) {
    if (sub === 'repeatBegin') return { h: 'measureStart', v: 'staffCenter', scaleToFit: true }
    if (sub === 'repeatEnd') return { h: 'measureEnd', v: 'staffCenter', scaleToFit: true }
    return { h: 'measureStart', v: 'aboveStaff', scaleToFit: true }
  }
  return { h: 'measureStart', v: 'aboveNotes' }
}

// ── geometry inputs (populated by the render layer) ──────────────────────────

export interface StaffGeom {
  topY: number       // top staff line y
  bottomY: number    // bottom staff line y
}

export interface MeasureGeom {
  measureId: string
  leftX: number
  noteStartX: number // x after clef/key/time sig
  rightX: number
  topNoteY: number | null    // highest notehead across the measure (null = empty bar)
  bottomNoteY: number | null // lowest notehead across the measure
}

export interface EventGeom {
  x: number          // visual center of the notehead (so 'event'/'eventHead' marks center on the note)
  topY: number       // highest notehead of this event
  bottomY: number    // lowest notehead of this event
  stemTopY: number
  stemBottomY: number
}

export interface PlacementGeom {
  staff: StaffGeom
  measures: Map<string, MeasureGeom>
  events: Map<string, EventGeom>   // keyed by event id
}

/** A resolved mark position. `x2/y2` are set for two-endpoint line marks. */
export interface ResolvedPlacement {
  x: number
  y: number
  x2?: number
  y2?: number
}

// Padding constants (px).
const PAD_ABOVE_STAFF = 26
const PAD_ABOVE_NOTES = 22
const PAD_BELOW_NOTES = 22
const PAD_LEFT = 16
const ROW_H = 20          // vertical step when stacking to avoid overlap
const START_INSET = 8     // px right of noteStartX so a mark clears the sig area
const DEFAULT_W = 22      // fallback mark half-life for overlap testing

// ── resolution ───────────────────────────────────────────────────────────────

function estHalfWidth(ann: Annotation): number {
  if (ann.kind === 'text') return Math.max(DEFAULT_W, (ann.text.length * ann.style.fontSize * 0.3))
  return DEFAULT_W
}

/** Horizontal center for a mark, from its rule + geometry. */
function resolveX(rule: PlacementRule, m: MeasureGeom, ev: EventGeom | undefined): number {
  switch (rule.h) {
    case 'measureCenter': return (m.noteStartX + m.rightX) / 2
    case 'measureEnd': return m.rightX - START_INSET
    case 'event': return ev ? ev.x : m.noteStartX + START_INSET
    case 'eventHead': return ev ? ev.x : m.noteStartX + START_INSET
    case 'eventLeft': return ev ? ev.x - PAD_LEFT : m.noteStartX + START_INSET
    case 'measureStart':
    default: return m.noteStartX + START_INSET
  }
}

/** Base vertical center for a zone (before stacking), from geometry. */
function resolveBaseY(zone: VZone, staff: StaffGeom, m: MeasureGeom, ev: EventGeom | undefined): number {
  switch (zone) {
    case 'aboveStaff': return staff.topY - PAD_ABOVE_STAFF
    case 'aboveNotes': {
      const top = ev ? ev.topY : m.topNoteY ?? staff.topY
      return Math.min(top, staff.topY) - PAD_ABOVE_NOTES
    }
    case 'belowNotes': {
      const bottom = ev ? ev.bottomY : m.bottomNoteY ?? staff.bottomY
      return Math.max(bottom, staff.bottomY) + PAD_BELOW_NOTES
    }
    case 'onStem': return ev ? (ev.stemTopY + ev.stemBottomY) / 2 : (staff.topY + staff.bottomY) / 2
    case 'onNote': return ev ? (ev.topY + ev.bottomY) / 2 : (staff.topY + staff.bottomY) / 2
    case 'staffCenter': return (staff.topY + staff.bottomY) / 2
  }
}

interface Placed { x: number; halfW: number; y: number }

/** True when two horizontal spans overlap (with a small gap). */
function overlapsX(ax: number, aw: number, bx: number, bw: number): boolean {
  return Math.abs(ax - bx) < aw + bw + 4
}

/**
 * Resolve every auto mark in `annotations` to a concrete (x, y), stacking marks that share a zone and
 * overlap horizontally so none collide. Returns a Map keyed by annotation id; marks whose geometry is
 * missing (measure off-screen) are omitted and fall back to their stored dx/dy in the layer.
 *
 * Stacking: within each vertical side (above / below), marks are placed outward from the staff. A mark
 * that overlaps an already-placed one at its level is pushed one ROW_H further out. Dynamics with
 * `flipIfBelowOccupied` move to the ABOVE side when their below slot is taken (the user's rule:
 * "dynamics default below, but above if something is already below").
 */
export function layoutMeasureMarks(annotations: Annotation[], geom: PlacementGeom): Map<string, ResolvedPlacement> {
  const out = new Map<string, ResolvedPlacement>()
  // Track placed spans per side so we can stack outward and test overlap.
  const aboveRows: Placed[] = []
  const belowRows: Placed[] = []

  // Deterministic order: measure-start marks before beat marks, so stacking is stable.
  const marks = annotations.filter(a => a.anchor.auto)

  for (const ann of marks) {
    const rule = placementRuleFor(ann)
    const m = geom.measures.get(ann.anchor.measureId)
    if (!m) continue
    const ev = ann.anchor.eventId ? geom.events.get(ann.anchor.eventId) : undefined

    const x = resolveX(rule, m, ev)
    const halfW = estHalfWidth(ann)

    // Two-endpoint line marks: resolve both endpoints, no stacking. A glissando connects the two
    // NOTEHEADS directly (diagonal line); a trill extension rides above the notes.
    if (rule.twoEnd && ann.kind === 'line') {
      const endEv = ann.endEventId ? geom.events.get(ann.endEventId) : undefined
      const headY = (e: EventGeom | undefined, fallback: number) => e ? (e.topY + e.bottomY) / 2 : fallback
      const isGliss = ann.lineType === 'gliss'
      const y = isGliss ? headY(ev, geom.staff.topY) : resolveBaseY(rule.v, geom.staff, m, ev)
      const x2 = endEv ? endEv.x : x + 40
      const y2 = isGliss ? headY(endEv, y) : (endEv ? resolveBaseY(rule.v, geom.staff, m, endEv) : y)
      out.set(ann.id, { x, y, x2, y2 })
      continue
    }

    // Pick a side. Non-stacking zones (onStem/onNote/staffCenter) place directly.
    if (rule.v === 'onStem' || rule.v === 'onNote' || rule.v === 'staffCenter') {
      out.set(ann.id, { x, y: resolveBaseY(rule.v, geom.staff, m, ev) })
      continue
    }

    let side: 'above' | 'below' = rule.v === 'belowNotes' ? 'below' : 'above'
    // Dynamics flip above when their below slot is already occupied.
    if (rule.flipIfBelowOccupied && side === 'below' && belowRows.some(p => overlapsX(x, halfW, p.x, p.halfW))) {
      side = 'above'
    }

    const rows = side === 'below' ? belowRows : aboveRows
    const baseY = side === 'below'
      ? resolveBaseY('belowNotes', geom.staff, m, ev)
      : resolveBaseY(rule.v === 'belowNotes' ? 'aboveNotes' : rule.v, geom.staff, m, ev)

    // Push outward past any overlapping already-placed mark on this side.
    for (let level = 0; ; level++) {
      const y = baseY + (side === 'below' ? level * ROW_H : -level * ROW_H)
      const clash = rows.some(p => Math.abs(p.y - y) < ROW_H - 2 && overlapsX(x, halfW, p.x, p.halfW))
      if (!clash || level > 20) { rows.push({ x, halfW, y }); out.set(ann.id, { x, y }); break }
    }
  }

  return out
}
