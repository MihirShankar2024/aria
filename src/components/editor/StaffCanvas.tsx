import { useEffect, useRef, useState } from 'react'
import { renderStaff, type StaffLayout, type NoteGeometry } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, isMeasureFull, noteCanFit } from '../../lib/beats'
import { computeTieSpans } from '../../lib/ties'
import type { Measure, TimeSig, KeySig, Duration, Accidental, Tie } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const STAVE_Y = 40
const DOT_R = 7  // hover dot radius in px

// Derived constants (computed once)
const STAVE_TOP_Y = STAVE_Y + STAVE_TOP_OFFSET           // = 80: y of top staff line
const STAVE_BOTTOM_Y = STAVE_TOP_Y + 4 * LINE_SPACING   // = 120: y of bottom staff line

interface StaffCanvasProps {
  partId: string
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  dispatch: (action: ScoreAction) => void
  selectedDuration: Duration
  selectedAccidental: Accidental
  isDotted: boolean
  isRest: boolean
  ties: Tie[]
  isTieMode: boolean
  isFillMode: boolean
  onNotePlaced?: () => void
  onTieComplete?: () => void
  onFillComplete?: () => void
}

interface HoverInfo {
  x: number    // mouse X relative to containerRef
  snapY: number // snapped Y of nearest diatonic step
}

// In-progress tie drag: the anchor note and the current cursor point (for the rubber-band line).
interface TieDrag {
  fromId: string
  fromX: number
  fromY: number
  curX: number
  curY: number
}

export function StaffCanvas({
  partId,
  measures,
  timeSig,
  keySig,
  dispatch,
  selectedDuration,
  selectedAccidental,
  isDotted,
  isRest,
  ties,
  isTieMode,
  isFillMode,
  onNotePlaced,
  onTieComplete,
  onFillComplete,
}: StaffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [layout, setLayout] = useState<StaffLayout | null>(null)
  const [tieDrag, setTieDrag] = useState<TieDrag | null>(null)
  const [hoverMeasure, setHoverMeasure] = useState<number | null>(null)  // fill-mode highlight

  useEffect(() => {
    if (!containerRef.current) return
    try {
      const result = renderStaff({
        container: containerRef.current,
        measures,
        timeSig,
        keySig,
        ties,
        staveY: STAVE_Y,
      })
      setLayout(result)
    } catch (err) {
      // Never let a render error tear down the editor — keep the last good layout.
      console.error('Staff render failed', err)
    }
  }, [measures, timeSig, keySig, ties])

  // Nearest placed note (not rest) to a given x — the drag-to-tie hit target.
  const nearestNoteAtX = (x: number): NoteGeometry | null => {
    if (!layout) return null
    let best: NoteGeometry | null = null
    let bestDist = Infinity
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  const getCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Map an X coordinate to a measure using the rendered geometry (variable widths).
  const getMeasureIndexAtX = (x: number): number => {
    if (!layout) return -1
    for (let i = 0; i < layout.measures.length; i++) {
      const g = layout.measures[i]
      if (x >= g.x && x < g.x + g.width) return i
    }
    // Past the last barline → snap to the last measure.
    return layout.measures.length - 1
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isFillMode) {
      const coords = getCoords(e)
      setHoverMeasure(coords ? getMeasureIndexAtX(coords.x) : null)
      return
    }
    if (isTieMode) {
      if (!tieDrag) return
      const coords = getCoords(e)
      if (!coords) return
      setTieDrag({ ...tieDrag, curX: coords.x, curY: coords.y })
      return
    }
    if (isRest) { setHoverInfo(null); return }
    const coords = getCoords(e)
    if (!coords) return
    const stepsDown = Math.round((coords.y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    setHoverInfo({ x: coords.x, snapY })
  }

  // Drag-to-tie: anchor on mousedown, span to the note under mouseup.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTieMode) return
    const coords = getCoords(e)
    if (!coords) return
    const note = nearestNoteAtX(coords.x)
    if (!note) return
    setTieDrag({ fromId: note.id, fromX: note.x, fromY: note.y, curX: coords.x, curY: coords.y })
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTieMode || !tieDrag) return
    const coords = getCoords(e)
    const target = coords ? nearestNoteAtX(coords.x) : null
    setTieDrag(null)
    if (!target || target.id === tieDrag.fromId) return
    const newTies = computeTieSpans(measures, tieDrag.fromId, target.id)
    if (newTies.length === 0) return
    dispatch({ type: 'ADD_TIES', partId, ties: newTies })
    onTieComplete?.()  // one-shot: leave tie mode after a successful span
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (measures.length === 0) return
    if (isFillMode) {
      const coords = getCoords(e)
      if (!coords) return
      const measure = measures[getMeasureIndexAtX(coords.x)]
      if (!measure) return
      dispatch({ type: 'FILL_MEASURE_RESTS', partId, measureId: measure.id })
      onFillComplete?.()  // one-shot: leave fill mode after a click
      return
    }
    if (isTieMode) return  // tie mode owns mousedown/up; never place a note
    const coords = getCoords(e)
    if (!coords) return
    const idx = getMeasureIndexAtX(coords.x)
    const measure = measures[idx]
    if (!measure) return

    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (!noteCanFit(measure, candidate, timeSig)) return  // measure full — reject silently

    if (isRest) {
      dispatch({
        type: 'ADD_REST',
        partId,
        measureId: measure.id,
        rest: { id: crypto.randomUUID(), type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 },
      })
      onNotePlaced?.()
    } else {
      const pitch = staffYToPitch(coords.y, STAVE_Y)
      // Apply toolbar accidental; null means natural (no override)
      const finalPitch = selectedAccidental !== null
        ? { ...pitch, accidental: selectedAccidental }
        : pitch
      dispatch({
        type: 'ADD_NOTE',
        partId,
        measureId: measure.id,
        note: {
          id: crypto.randomUUID(),
          type: 'note',
          pitch: finalPitch,
          duration: selectedDuration,
          dots: isDotted ? 1 : 0,
          tied: false,
        },
      })
      onNotePlaced?.()
    }
  }

  // Measure validity overlays — positioned from the rendered geometry.
  const measureOverlays = layout?.measures.map((g, i) => {
    const measure = measures[i]
    if (!measure) return null
    const beatCount = measureBeatCount(measure)
    if (beatCount < 0.001) return null  // empty — no indicator
    const full = isMeasureFull(measure, timeSig)
    return (
      <div
        key={measure.id}
        className="absolute pointer-events-none"
        style={{
          left: g.x,
          top: STAVE_TOP_Y,
          width: g.width,
          height: STAVE_BOTTOM_Y - STAVE_TOP_Y,
          background: full ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.10)',
          borderTop: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          borderBottom: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          zIndex: 5,
        }}
      />
    )
  })

  return (
    <div
      className={
        'bg-white rounded-lg p-4 inline-block select-none overflow-x-auto ' +
        (isTieMode || isFillMode ? 'cursor-pointer' : 'cursor-crosshair')
      }
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHoverInfo(null); setTieDrag(null); setHoverMeasure(null) }}
    >
      {/* Relative wrapper: VexFlow target + overlays share the same coordinate space */}
      <div className="relative inline-block">
        {/* VexFlow renders its SVG here; container.innerHTML is wiped on every re-render */}
        <div ref={containerRef} />

        {/* Measure validity overlays — siblings of containerRef, never wiped */}
        {measureOverlays}

        {/* Fill-mode hover highlight — the measure that a click will fill */}
        {isFillMode && hoverMeasure !== null && layout?.measures[hoverMeasure] && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: layout.measures[hoverMeasure].x,
              top: STAVE_TOP_Y,
              width: layout.measures[hoverMeasure].width,
              height: STAVE_BOTTOM_Y - STAVE_TOP_Y,
              background: 'rgba(139,92,246,0.18)',
              border: '1.5px solid rgba(139,92,246,0.6)',
              zIndex: 15,
            }}
          />
        )}

        {/* Tie drag — rubber-band line from the anchor note to the cursor */}
        {tieDrag && (
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}
          >
            <line
              x1={tieDrag.fromX}
              y1={tieDrag.fromY}
              x2={tieDrag.curX}
              y2={tieDrag.curY}
              stroke="rgba(139,92,246,0.8)"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            <circle cx={tieDrag.fromX} cy={tieDrag.fromY} r={4} fill="rgba(139,92,246,0.9)" />
          </svg>
        )}

        {/* Hover dot — snaps to nearest diatonic staff position */}
        {hoverInfo && !isRest && !isTieMode && (
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: hoverInfo.x - DOT_R,
              top: hoverInfo.snapY - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              background: 'rgba(139,92,246,0.75)',
              boxShadow: '0 0 14px 7px rgba(139,92,246,0.35)',
              zIndex: 20,
            }}
          />
        )}
      </div>
    </div>
  )
}
