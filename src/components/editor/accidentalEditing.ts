import type { GlyphGeometry } from '../../lib/vexflow/renderer'

// Shared logic for dragging a note's accidental/dot glyph to a new position. Mirrors
// slurEditing.ts: handles only surface for glyphs in the hovered measure, and the drag
// is committed as a pixel offset accumulated onto the pitch (see UPDATE_GLYPH_OFFSET).

export const GLYPH_HANDLE_R = 11

export interface GlyphEdit {
  partId: string
  measureId: string
  noteId: string
  pitchIndex: number
  kind: 'accidental' | 'dot'
  downX: number
  downY: number
  curX: number
  curY: number
}

// Nearest glyph handle to a point, if within grab radius.
export function hitGlyphHandle(glyphs: GlyphGeometry[], x: number, y: number): GlyphGeometry | null {
  let best: GlyphGeometry | null = null
  let bestDist = GLYPH_HANDLE_R
  for (const g of glyphs) {
    const d = Math.hypot(g.x - x, g.y - y)
    if (d <= bestDist) { best = g; bestDist = d }
  }
  return best
}
