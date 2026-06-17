import { StaveNote } from 'vexflow'
import type { TieCurveOverride } from '../../types/score'

// Auto-placement of tie/slur curves. This is a pure module: given the laid-out
// VexFlow notes it decides which side the curve bulges toward and how tall the
// arch is. The renderer applies the result and keeps any manual override on top.
//
// Sign convention (matches VexFlow's StaveTie usage — do NOT flip it):
//   direction === 1  → curve bulges DOWN / below the notes  (concave up)
//   direction === -1 → curve bulges UP / above the notes    (concave down)
export type CurveDirection = 1 | -1

// Ceiling on the auto arch height. Avoiding collisions is the top engraving priority,
// so this is set high enough that a phrase slur can rise clear over an interior peak that
// sits well above its (low) endpoints — the inner edge of the curve deflects 0.5·cp1 at
// the midpoint, so clearing a note ~1.5 octaves up needs cp ≈ 120+. It only acts as a
// guard against the pathological case of a tall note landing right next to an endpoint
// (where t→0 inflates the required cp); normal ties/slurs never approach it.
const MAX_CP = 160
const HALF_NOTEHEAD = 5

// Furthest Y of a note toward a curve's bulge, counting the stem/beam — not just
// the notehead. direction === 1 → curve bulges downward (larger y); -1 → upward
// (smaller y). This lets the arch clear stems/beams/accidentals that point into
// its path instead of only clearing noteheads.
export function extremeYTowardSlur(vn: StaveNote, direction: number): number {
  const ys = [...vn.getYs()]
  try {
    const ext = vn.getStemExtents()
    if (ext) ys.push(ext.topY, ext.baseY)
  } catch {
    // No stem (e.g. whole note) — noteheads are the only extent.
  }
  try {
    // Include the full glyph bounds so accidentals (and dots) poking toward the
    // curve are cleared, not just noteheads and stems.
    const bb = vn.getBoundingBox()
    if (bb) ys.push(bb.getY(), bb.getY() + bb.getH())
  } catch { /* bounding box unavailable — extents above suffice */ }
  return direction === 1 ? Math.max(...ys) : Math.min(...ys)
}

// Where a notehead sits within its (possibly chord) note. Smaller Y = higher on
// the staff, so the min-Y head is the visual top and the max-Y head the bottom.
type HeadRole = 'single' | 'top' | 'bottom' | 'inner'
function headRole(ys: number[], idx: number): HeadRole {
  if (ys.length <= 1) return 'single'
  const y = ys[idx]
  if (y === undefined) return 'single'
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  if (y === min) return 'top'
  if (y === max) return 'bottom'
  return 'inner'
}

export interface PlacementInput {
  isTie: boolean
  fromIdx: number
  toIdx: number
  // Per-notehead endpoint Ys at each end, already flattened (slurs) and shifted
  // (manual DY) by the caller.
  firstYs: number[]
  lastYs: number[]
  firstX: number
  lastX: number
  pixelSpan: number
  // The curve's domain, document order, endpoints first/last. For a single-voice slur
  // this is every note of that voice between the endpoints (the phrase contour); for a
  // tie or a cross-voice slur it is just the two endpoints. Drives stem majority, phrase
  // contour height, and intermediate-note collision avoidance.
  coveredNotes: StaveNote[]
  middleLineY: number
  // 2-voice hook (filled in once voice-awareness lands): upper voice forces the
  // curve above (-1), lower voice below (1). null/undefined → derive from notes.
  voiceSide?: CurveDirection | null
  override?: TieCurveOverride
}

export interface Placement {
  direction: CurveDirection
  cp1: number
  cp2: number
  repFirstIdx: number
  repLastIdx: number
}

// A multi-note slur should trace the phrase: bulge toward whichever side the interior
// melody pushes past the straight line between the endpoints, so the arch visibly
// encloses the contour (e.g. arcs *above* a peak instead of leaving it poking out).
// Measured on noteheads only (pitch contour, not stems). Returns null when there is no
// interior, the deviation is too small to matter (near-linear — defer to the stem rule),
// or this isn't a slur.
const PHRASE_CONTOUR_THRESHOLD = 8
function phraseContourSide(input: PlacementInput): CurveDirection | null {
  const { isTie, coveredNotes, firstYs, lastYs, fromIdx, toIdx, firstX, lastX } = input
  if (isTie || coveredNotes.length < 3) return null
  const y0 = firstYs[fromIdx]
  const y1 = lastYs[toIdx]
  if (y0 === undefined || y1 === undefined) return null
  const spanPx = (lastX - firstX) || 1
  let aboveDev = 0
  let belowDev = 0
  for (let k = 1; k < coveredNotes.length - 1; k++) {
    const ys = coveredNotes[k].getYs()
    if (!ys.length) continue
    const t = Math.max(0, Math.min(1, (coveredNotes[k].getAbsoluteX() - firstX) / spanPx))
    const baseY = (1 - t) * y0 + t * y1
    aboveDev = Math.max(aboveDev, baseY - Math.min(...ys)) // note rises above the line
    belowDev = Math.max(belowDev, Math.max(...ys) - baseY) // note dips below the line
  }
  if (Math.max(aboveDev, belowDev) < PHRASE_CONTOUR_THRESHOLD) return null
  return aboveDev >= belowDev ? -1 : 1
}

// Step 1: which side does the curve bulge toward? Priority order, first match wins.
function autoDirection(input: PlacementInput): CurveDirection {
  const { fromIdx, toIdx, firstYs, lastYs, coveredNotes, middleLineY, voiceSide } = input

  // 1. Voice separation always wins (upper above, lower below).
  if (voiceSide === 1 || voiceSide === -1) return voiceSide

  // 2. Phrase contour (multi-note slur): arc over a peak / under a valley so the
  //    slur encloses the interior melody it spans.
  const contour = phraseContourSide(input)
  if (contour) return contour

  // 3. Chord position: the curve follows the tied/slurred head. Top head arches
  //    above, bottom head below. Prefer the `from` end if it is a chord, else the
  //    `to` end. Interior heads fall through to the stem rule.
  const fromRole = headRole(firstYs, fromIdx)
  const toRole = headRole(lastYs, toIdx)
  const chordRole = fromRole !== 'single' ? fromRole : toRole
  if (chordRole === 'top') return -1
  if (chordRole === 'bottom') return 1

  // 4. Single voice: the curve goes opposite the stems (notehead side). Only notes
  //    that actually have a stem vote.
  let stemsUp = 0
  let stemsDown = 0
  for (const vn of coveredNotes) {
    if (!vn.hasStem()) continue
    if (vn.getStemDirection() === 1) stemsUp++
    else stemsDown++
  }
  if (stemsUp + stemsDown > 0) return stemsUp >= stemsDown ? -1 : 1

  // 5. Whole notes / no stems anywhere: standard practice keys off staff position —
  //    above when the head sits at or above the middle line, below otherwise.
  const headY = firstYs[fromIdx] ?? lastYs[toIdx] ?? middleLineY
  return headY <= middleLineY ? -1 : 1
}

// The outermost tied head on the side the arch bulges toward — used as the curve's
// representative endpoint for hit-testing/drag handles.
function repPick(ys: number[], idxs: number[], direction: CurveDirection): number {
  let best = idxs[0]
  for (const i of idxs) {
    const yi = ys[i] ?? 0
    const yb = ys[best] ?? 0
    if (direction === 1 ? yi > yb : yi < yb) best = i
  }
  return best
}

export function computeCurvePlacement(input: PlacementInput): Placement {
  const { isTie, fromIdx, toIdx, firstYs, lastYs, firstX, lastX, pixelSpan, coveredNotes, override } = input

  const direction: CurveDirection = override?.direction ?? autoDirection(input)

  const repFirstIdx = repPick(firstYs, [fromIdx], direction)
  const repLastIdx = repPick(lastYs, [toIdx], direction)

  // Step 2: arch height. Ties stay compact; slurs scale with span (~1 / ~1.5–2 /
  // ~2.5–3 staff spaces per docs/tie-rules-spec.md) and additionally rise with the
  // phrase's vertical range so a wide melodic contour gets a proportionally taller
  // arch instead of a flat one (a tie has no phrase, so no contour term).
  let verticalRange = 0
  if (!isTie) {
    let minY = Infinity
    let maxY = -Infinity
    for (const vn of coveredNotes) {
      for (const y of vn.getYs()) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxY >= minY) verticalRange = maxY - minY
  }
  const spanBasedCp = isTie
    ? 6
    : (pixelSpan < 60 ? 10 : pixelSpan < 180 ? 18 : 28) + verticalRange * 0.15
  const tolerance = pixelSpan < 60 ? -2 : pixelSpan < 180 ? 0 : 3

  const firstY = firstYs[repFirstIdx] ?? 0
  const lastY = lastYs[repLastIdx] ?? 0
  const spanPx = (lastX - firstX) || 1

  // Raise the arch enough to clear any intermediate covered note (incl. its stem/beam).
  // Ties and cross-voice slurs have no intermediates here, so this is a no-op for them.
  let contentBasedCp = 0
  for (let k = 1; k < coveredNotes.length - 1; k++) {
    const vn = coveredNotes[k]
    if (!vn || !vn.getYs().length) continue
    const edgeY = extremeYTowardSlur(vn, direction) + direction * HALF_NOTEHEAD
    const t = Math.max(0.05, Math.min(0.95, (vn.getAbsoluteX() - firstX) / spanPx))
    const yLine = (1 - t) * firstY + t * lastY
    const excess = (edgeY - yLine) * direction - tolerance
    if (excess > 0) {
      const needed = excess / (2 * t * (1 - t))
      if (needed > contentBasedCp) contentBasedCp = needed
    }
  }

  const cp1 = override?.cp1 ?? Math.min(MAX_CP, Math.max(spanBasedCp, contentBasedCp))
  const cp2 = override?.cp2 ?? cp1 + 4

  return { direction, cp1, cp2, repFirstIdx, repLastIdx }
}
