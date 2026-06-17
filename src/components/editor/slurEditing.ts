import type { TieGeometry } from '../../lib/vexflow/renderer'
import type { TieCurveOverride } from '../../types/score'

// Shared math for dragging a placed slur/tie's handles. Used by both the single
// staff and grand staff canvases.

export const SLUR_HANDLE_R = 10
// VexFlow StaveTie shifts endpoints by yShift along the slur direction, then draws a
// quadratic arc whose visual peak sits at midY + direction * (yShift + 0.5 * cp1).
const VEX_Y_SHIFT = 7
const APEX_OFFSET = 8         // handle sits this far past the visual peak for grabbing
const MIN_CP = 4
const MAX_CP = 240

export type SlurHandle = 'start' | 'end' | 'apex'

export interface SlurEdit {
  partId: string
  tieId: string
  handle: SlurHandle
  geo: TieGeometry
  downX: number
  downY: number
  curX: number
  curY: number
}

export interface Point { x: number; y: number }

export function slurHandlePoints(geo: TieGeometry): Record<SlurHandle, Point> {
  const midX = (geo.startX + geo.endX) / 2
  const midY = (geo.startY + geo.endY) / 2
  return {
    start: { x: geo.startX, y: geo.startY },
    end:   { x: geo.endX,   y: geo.endY },
    apex:  { x: midX, y: midY + geo.direction * (VEX_Y_SHIFT + 0.5 * geo.cp1 + APEX_OFFSET) },
  }
}

// SVG path for the slur/tie's drawn arc. Mirrors VexFlow's quadratic: the visual
// peak sits at midY + direction*(VEX_Y_SHIFT + 0.5*cp1), so the quadratic control
// point (peak = 0.5*mid + 0.5*cp) is midY + direction*(2*VEX_Y_SHIFT + cp1).
export function slurArcPath(geo: TieGeometry): string {
  const midX = (geo.startX + geo.endX) / 2
  const midY = (geo.startY + geo.endY) / 2
  const cpY = midY + geo.direction * (2 * VEX_Y_SHIFT + geo.cp1)
  return `M ${geo.startX} ${geo.startY} Q ${midX} ${cpY} ${geo.endX} ${geo.endY}`
}

// Nearest handle to a point, if within grab radius. Apex wins ties so the arch is
// easy to grab even when it overlaps an endpoint on short slurs.
export function hitSlurHandle(
  ties: TieGeometry[],
  x: number,
  y: number,
): { tieId: string; handle: SlurHandle; geo: TieGeometry } | null {
  for (const geo of ties) {
    const pts = slurHandlePoints(geo)
    for (const handle of ['apex', 'start', 'end'] as const) {
      const p = pts[handle]
      if (Math.hypot(p.x - x, p.y - y) <= SLUR_HANDLE_R) return { tieId: geo.id, handle, geo }
    }
  }
  return null
}

// The override patch to commit after a handle drag. Endpoint shifts accumulate onto
// the tie's existing override; the apex sets an absolute direction + arch depth, so
// dragging it across the staff flips the slur to the other side.
export function slurEditPatch(
  edit: SlurEdit,
  curX: number,
  curY: number,
  current?: TieCurveOverride,
): Partial<TieCurveOverride> {
  const dx = curX - edit.downX
  const dy = curY - edit.downY
  if (edit.handle === 'start') {
    return { startDX: (current?.startDX ?? 0) + dx, startDY: (current?.startDY ?? 0) + dy }
  }
  if (edit.handle === 'end') {
    return { endDX: (current?.endDX ?? 0) + dx, endDY: (current?.endDY ?? 0) + dy }
  }
  // apex — invert VexFlow's peak formula so the drawn curve reaches the dragged handle
  const midY = (edit.geo.startY + edit.geo.endY) / 2
  const offset = curY - midY
  const direction: 1 | -1 = offset >= 0 ? 1 : -1
  const cp1 = Math.max(
    MIN_CP,
    Math.min(MAX_CP, 2 * (Math.abs(offset) - VEX_Y_SHIFT - APEX_OFFSET)),
  )
  return { direction, cp1, cp2: cp1 + 4 }
}
