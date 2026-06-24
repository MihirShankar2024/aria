import type { Annotation } from '../../types/score'

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Axis-aligned bounding box (canvas px) of a placed annotation, given its measure's resolved
 * left-edge x and the staff top. Used by the broom to register/highlight the mark's *entire*
 * area (like accidentals/ties/tempo), not just a point. Glyph & text marks are centred on their
 * anchor; line marks span their two endpoints.
 */
export function annotationBounds(ann: Annotation, mx: number, staveY: number): Rect {
  const ax = mx + ann.anchor.dx
  const ay = staveY + ann.anchor.dy

  if (ann.kind === 'line') {
    const ex = mx + ann.endDX
    const ey = staveY + ann.endDY
    const minX = Math.min(ax, ex)
    const minY = Math.min(ay, ey)
    const pad = 8
    return { x: minX - pad, y: minY - pad, w: Math.abs(ex - ax) + pad * 2, h: Math.abs(ey - ay) + pad * 2 }
  }

  if (ann.kind === 'glyph') {
    const fs = 30 * (ann.scale ?? 1)
    const w = Math.max(16, fs * Math.max(1, ann.glyph.length) * 0.62) * (ann.scaleX ?? 1)
    const h = fs * (ann.scaleY ?? 1)
    return { x: ax - w / 2, y: ay - h / 2, w, h }
  }

  // text — centred on its anchor
  const fs = ann.style.fontSize
  const w = Math.max(20, (ann.text.length || 1) * fs * 0.6)
  const h = fs * 1.3
  return { x: ax - w / 2, y: ay - h / 2, w, h }
}

/** True when point (px,py) lies within `r` expanded by `pad` (brush radius). */
export function rectHit(r: Rect, px: number, py: number, pad: number): boolean {
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad
}
