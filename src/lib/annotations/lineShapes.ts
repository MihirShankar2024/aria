import type { LineAnnotationType } from '../../types/score'

/**
 * Geometry builders for stretchable line/bracket annotations. Each builder takes the start
 * and end points (already resolved to canvas px) and returns SVG primitives the overlay
 * layer renders. Lines are drawn freeform between two user-dragged endpoints — the same model
 * professional engravers use for hairpins, octave lines, endings, pedal brackets, and gliss.
 */

export interface LineShape {
  /** Polylines / lines drawn as <path> stroke data (no fill). */
  paths: { d: string; dashed?: boolean; width?: number }[]
  /** Bravura glyph labels positioned at a point (e.g. the "8va" prefix). */
  glyphs?: { x: number; y: number; text: string; size: number }[]
  /** Plain text labels (e.g. "1." for endings). */
  texts?: { x: number; y: number; text: string; size: number; italic?: boolean }[]
}

const HOOK = 10 // vertical hook length for brackets/octave/pedal/endings

// SMuFL octave-prefix glyphs.
const OTTAVA_ALTA = String.fromCodePoint(0xe511)    // "8va" above
const OTTAVA_BASSA = String.fromCodePoint(0xe51c)   // "8vb" below (ottavaBassaVb)

/**
 * Default end endpoint (relative to the measure-left origin) for a freshly spawned line mark.
 * Most are a horizontal 80px span; glissando spawns at a 45° diagonal with the left end lower
 * (so it reads as a rising gesture before the user adjusts it).
 */
export function defaultLineEnd(type: LineAnnotationType, dx: number, dy: number): { endDX: number; endDY: number } {
  if (type === 'gliss') return { endDX: dx + 70, endDY: dy - 70 } // 45°, left side lower
  return { endDX: dx + 80, endDY: dy }
}

export function buildLineShape(
  type: LineAnnotationType,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): LineShape {
  const len = Math.hypot(x2 - x1, y2 - y1)
  switch (type) {
    case 'gliss':
      return { paths: [{ d: `M ${x1} ${y1} L ${x2} ${y2}`, width: 1.5 }] }

    case 'trillExt':
      return {
        paths: [{ d: `M ${x1 + 16} ${y1} L ${x2} ${y1}`, dashed: true, width: 1.5 }],
        glyphs: [{ x: x1, y: y1 + 6, text: String.fromCodePoint(0xe566), size: 22 }],
      }

    // Hairpins: a symmetric wedge about the start→end axis with a fixed ~30° total opening,
    // so the base case is already a proper wedge (never a flat line) and it tilts/stretches
    // with the endpoints. cresc opens toward the end; decresc opens toward the start.
    case 'cresc':
    case 'decresc': {
      const ux = len ? (x2 - x1) / len : 1
      const uy = len ? (y2 - y1) / len : 0
      const px = -uy, py = ux            // unit perpendicular to the axis
      const h = len * Math.tan((15 * Math.PI) / 180)  // half-opening for a 30° wedge
      const tip = type === 'cresc' ? { x: x1, y: y1 } : { x: x2, y: y2 }
      const mouth = type === 'cresc' ? { x: x2, y: y2 } : { x: x1, y: y1 }
      return {
        paths: [
          { d: `M ${tip.x} ${tip.y} L ${mouth.x + px * h} ${mouth.y + py * h}` },
          { d: `M ${tip.x} ${tip.y} L ${mouth.x - px * h} ${mouth.y - py * h}` },
        ],
      }
    }

    case 'ottava8va': // "8va" + dashed line + down hook at the end
      return {
        paths: [{ d: `M ${x1 + 22} ${y1} L ${x2} ${y1} L ${x2} ${y1 + HOOK}`, dashed: true }],
        glyphs: [{ x: x1, y: y1 + 6, text: OTTAVA_ALTA, size: 22 }],
      }

    case 'ottava8vb': // "8vb" + dashed line + up hook at the end
      return {
        paths: [{ d: `M ${x1 + 22} ${y1} L ${x2} ${y1} L ${x2} ${y1 - HOOK}`, dashed: true }],
        glyphs: [{ x: x1, y: y1 + 6, text: OTTAVA_BASSA, size: 22 }],
      }

    case 'ending1': // solid bracket: down hook, span, down hook + "1." label
      return {
        paths: [{ d: `M ${x1} ${y1 + HOOK} L ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y1 + HOOK}` }],
        texts: [{ x: x1 + 6, y: y1 + 14, text: '1.', size: 13 }],
      }

    case 'ending2': // open bracket on the right (no closing hook) + "2." label
      return {
        paths: [{ d: `M ${x1} ${y1 + HOOK} L ${x1} ${y1} L ${x2} ${y1}` }],
        texts: [{ x: x1 + 6, y: y1 + 14, text: '2.', size: 13 }],
      }

    case 'pedalBracket': // down hook, horizontal span, down hook
      return {
        paths: [{ d: `M ${x1} ${y1} L ${x1} ${y1 + HOOK} L ${x2} ${y1 + HOOK} L ${x2} ${y1}` }],
      }

    default: {
      const _exhaustive: never = type
      void _exhaustive
      void len
      return { paths: [] }
    }
  }
}
