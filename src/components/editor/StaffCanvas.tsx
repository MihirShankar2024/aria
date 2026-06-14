import { useEffect, useRef, useState } from 'react'
import { renderStaff, type StaffLayout, type NoteGeometry } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, isMeasureFull, noteCanFit, measureRemainingBeats } from '../../lib/beats'
import { computeTieSpans } from '../../lib/ties'
import { InsertStaff } from './InsertStaff'
import type { ScrollSync } from '../../hooks/useScrollSync'
import { slurHandlePoints, hitSlurHandle, slurEditPatch, SLUR_HANDLE_R, type SlurEdit } from './slurEditing'
import { useDeleteTrail, TRAIL_MS, type PendingRest } from './useDeleteTrail'
import { applyRestErase } from '../../lib/rests'
import type { Measure, TimeSig, KeySig, Duration, Accidental, Tie, Clef, NoteEvent } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const STAVE_Y = 40
const DOT_R = 7
const CHORD_PROXIMITY_X = 20  // px — click within this of an existing note's x-center → chord add
const BRUSH_R = 15            // px radius of the delete brush

const STAVE_TOP_Y    = STAVE_Y + STAVE_TOP_OFFSET
const STAVE_BOTTOM_Y = STAVE_TOP_Y + 4 * LINE_SPACING
const CARD_PAD = 16  // px — the card's p-4 padding; offsets content from the (unclipped) wrapper edge

interface StaffCanvasProps {
  partId: string
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  clef?: Clef
  dispatch: (action: ScoreAction) => void
  selectedDuration: Duration
  selectedAccidental: Accidental
  isDotted: boolean
  isRest: boolean
  ties: Tie[]
  isTieMode: boolean
  isFillMode: boolean
  isDeleteMode: boolean
  isInsertMode: boolean
  initialTempo?: number
  tempoChanges?: { measureNumber: number; tempo: number }[]
  forcedStaveWidths?: number[]
  scrollSync?: ScrollSync
  pendingRestIds?: Set<string>
  onNotePlaced?: () => void
  onTieComplete?: () => void
  onFillComplete?: () => void
  onInsertComplete?: () => void
  onRestsCommitted?: (pending: PendingRest[]) => void
}

// A chosen insertion point: insert before measure.notes[gapIndex] in measure `measureIndex`.
interface InsertSession {
  measureIndex: number
  gapIndex: number
  anchorX: number
}

interface HoverInfo {
  x: number
  snapY: number
  isChordTarget: boolean  // true when hovering near an existing note
  restTarget: { x: number; y: number } | null  // the rest this click would replace
}

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
  clef = 'treble',
  dispatch,
  selectedDuration,
  selectedAccidental,
  isDotted,
  isRest,
  ties,
  isTieMode,
  isFillMode,
  isDeleteMode,
  isInsertMode,
  initialTempo,
  tempoChanges = [],
  forcedStaveWidths,
  scrollSync,
  pendingRestIds,
  onNotePlaced,
  onTieComplete,
  onFillComplete,
  onInsertComplete,
  onRestsCommitted,
}: StaffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [layout, setLayout] = useState<StaffLayout | null>(null)
  const [tieDrag, setTieDrag] = useState<TieDrag | null>(null)
  const [slurEdit, setSlurEdit] = useState<SlurEdit | null>(null)
  const [hoverMeasure, setHoverMeasure] = useState<number | null>(null)
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set())
  const [insertHover, setInsertHover] = useState<InsertSession | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  const markingRef = useRef(false)
  const markedRef = useRef<Set<string>>(new Set())  // synchronous mirror of markedIds
  const clickCooldownRef = useRef(0)
  const pendingCenterRef = useRef<number | null>(null)
  const { trail, push: pushTrail } = useDeleteTrail(isDeleteMode)

  useEffect(() => {
    if (!containerRef.current) return
    try {
      const result = renderStaff({
        container: containerRef.current,
        measures,
        timeSig,
        keySig,
        clef,
        ties,
        staveY: STAVE_Y,
        initialTempo,
        tempoChanges,
        forcedStaveWidths,
      })
      setLayout(result)
    } catch (err) {
      console.error('Staff render failed', err)
    }
  }, [measures, timeSig, keySig, clef, ties, initialTempo, tempoChanges, forcedStaveWidths])

  // After an edit re-renders the staff, smoothly recenter the active measure once
  // it drifts into the right quarter of the viewport (or off the left).
  useEffect(() => {
    const idx = pendingCenterRef.current
    if (idx === null || !layout) return
    pendingCenterRef.current = null
    const sc = scrollRef.current
    const g = layout.measures[idx]
    if (!sc || !g) return
    if (sc.scrollWidth <= sc.clientWidth) return
    const relRight = g.x + g.width - sc.scrollLeft
    const offLeft = g.x < sc.scrollLeft
    if (relRight <= 0.75 * sc.clientWidth && !offLeft) return
    const target = Math.max(0, Math.min(g.x + g.width / 2 - sc.clientWidth / 2, sc.scrollWidth - sc.clientWidth))
    if (scrollSync) scrollSync.scrollAllTo(target, true)
    else sc.scrollTo({ left: target, behavior: 'smooth' })
  }, [layout, scrollSync])

  // Leaving delete mode abandons any in-progress marks.
  useEffect(() => {
    if (!isDeleteMode) { markingRef.current = false; markedRef.current = new Set(); setMarkedIds(new Set()) }
  }, [isDeleteMode])

  // Leaving insert mode abandons any in-progress insertion.
  useEffect(() => {
    if (!isInsertMode) { setInsertSession(null); setInsertHover(null) }
  }, [isInsertMode])

  const commitInsert = (events: NoteEvent[]) => {
    if (insertSession) {
      const measure = measures[insertSession.measureIndex]
      if (measure && events.length > 0) {
        pendingCenterRef.current = insertSession.measureIndex
        dispatch({ type: 'INSERT_EVENTS', partId, measureId: measure.id, index: insertSession.gapIndex, events })
      }
    }
    setInsertSession(null)
    onInsertComplete?.()
  }

  // Find the nearest note (not rest) within CHORD_PROXIMITY_X of an x position.
  const nearestNoteAtX = (x: number, maxDist = Infinity): NoteGeometry | null => {
    if (!layout) return null
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  // Find the nearest rest within CHORD_PROXIMITY_X of an x position (for replace-on-rest).
  const nearestRestAtX = (x: number, maxDist = CHORD_PROXIMITY_X): NoteGeometry | null => {
    if (!layout) return null
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of layout.notes) {
      if (n.type !== 'rest') continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  // Resolve a cursor x to an insertion gap within a measure: which slot to insert
  // before, and the x to anchor the marker/scratch staff at.
  const gapAtX = (measureIndex: number, cursorX: number): InsertSession | null => {
    if (!layout) return null
    const g = layout.measures[measureIndex]
    if (!g) return null
    const xs = layout.notes.filter(n => n.measureIndex === measureIndex).map(n => n.x).sort((a, b) => a - b)
    const gapIndex = xs.filter(x => x < cursorX).length
    const leftX = gapIndex === 0 ? g.x + 8 : xs[gapIndex - 1]
    const rightX = gapIndex === xs.length ? g.x + g.width - 8 : xs[gapIndex]
    return { measureIndex, gapIndex, anchorX: (leftX + rightX) / 2 }
  }

  const getCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const getMeasureIndexAtX = (x: number): number => {
    if (!layout) return -1
    for (let i = 0; i < layout.measures.length; i++) {
      const g = layout.measures[i]
      if (x >= g.x && x < g.x + g.width) return i
    }
    return layout.measures.length - 1
  }

  // Mark (don't delete) every note/rest within the brush at (x, y). Deferred —
  // nothing is mutated until the stroke is released, so notes don't shift mid-drag.
  const markAt = (x: number, y: number) => {
    if (!layout) return
    const r2 = BRUSH_R * BRUSH_R
    let added = false
    for (const n of layout.notes) {
      if (markedRef.current.has(n.id)) continue
      const dx = n.x - x
      // Hit any notehead in a chord (or the rest glyph), not just the lowest.
      if (!n.ys.some(ny => dx * dx + (ny - y) * (ny - y) <= r2)) continue
      markedRef.current.add(n.id); added = true
    }
    if (added) setMarkedIds(new Set(markedRef.current))
  }

  // On release, turn marked notes into beat-correct in-place rests and report the
  // resulting red rests up for the confirm-collapse step.
  const commitMarks = () => {
    markingRef.current = false
    const marked = markedRef.current
    markedRef.current = new Set()
    setMarkedIds(new Set())
    if (marked.size === 0 || !layout) return
    const byMeasure = new Map<number, Set<string>>()
    for (const n of layout.notes) {
      if (!marked.has(n.id)) continue
      const set = byMeasure.get(n.measureIndex) ?? new Set<string>()
      set.add(n.id)
      byMeasure.set(n.measureIndex, set)
    }
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    const pending: PendingRest[] = []
    const removedIds: string[] = []
    for (const [mIdx, ids] of byMeasure) {
      const measure = measures[mIdx]
      if (!measure) continue
      for (const id of ids) if (measure.notes.find(n => n.id === id)?.type === 'note') removedIds.push(id)
      // Re-normalizing re-IDs every rest, so fold this measure's already-pending red
      // rests into the marked set to keep them highlighted across successive deletes.
      for (const ev of measure.notes) if (pendingRestIds?.has(ev.id)) ids.add(ev.id)
      const { notes, redRestIds } = applyRestErase(measure.notes, ids, measure.timeSig ?? timeSig)
      edits.push({ partId, measureId: measure.id, notes })
      if (redRestIds.length) pending.push({ partId, measureId: measure.id, restIds: redRestIds })
    }
    if (edits.length === 0) return
    dispatch({ type: 'APPLY_MEASURE_NOTES', edits, removedIds })
    onRestsCommitted?.(pending)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDeleteMode) {
      const coords = getCoords(e)
      if (!coords) return
      pushTrail(coords.x, coords.y)
      if (markingRef.current) markAt(coords.x, coords.y)
      return
    }
    if (isFillMode) {
      const coords = getCoords(e)
      setHoverMeasure(coords ? getMeasureIndexAtX(coords.x) : null)
      return
    }
    if (isTieMode) {
      const coords = getCoords(e)
      if (!coords) { setHoverMeasure(null); return }
      setHoverMeasure(getMeasureIndexAtX(coords.x))
      if (slurEdit) { setSlurEdit({ ...slurEdit, curX: coords.x, curY: coords.y }); return }
      if (tieDrag) setTieDrag({ ...tieDrag, curX: coords.x, curY: coords.y })
      return
    }
    if (isInsertMode) {
      if (insertSession) return  // gap locked — building in the scratch staff
      const coords = getCoords(e)
      setInsertHover(coords ? gapAtX(getMeasureIndexAtX(coords.x), coords.x) : null)
      return
    }
    if (isRest) { setHoverInfo(null); return }
    const coords = getCoords(e)
    if (!coords) return
    const stepsDown = Math.round((coords.y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    const nearNote = nearestNoteAtX(coords.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(coords.x)
    setHoverInfo({ x: coords.x, snapY, isChordTarget: !!nearNote, restTarget: nearRest ? { x: nearRest.cx, y: nearRest.y } : null })
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return
    if (isDeleteMode) {
      if (performance.now() < clickCooldownRef.current) return
      markingRef.current = true
      pushTrail(coords.x, coords.y)
      markAt(coords.x, coords.y)
      return
    }
    if (!isTieMode) return
    // Editing a placed slur takes priority over starting a new one.
    const hit = layout ? hitSlurHandle(layout.ties, coords.x, coords.y) : null
    if (hit) {
      setSlurEdit({ partId, ...hit, downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y })
      return
    }
    const note = nearestNoteAtX(coords.x)
    if (!note) return
    setTieDrag({ fromId: note.id, fromX: note.x, fromY: note.y, curX: coords.x, curY: coords.y })
  }

  const endErase = () => {
    if (markingRef.current) {
      commitMarks()
      clickCooldownRef.current = performance.now() + 150
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDeleteMode) { endErase(); return }
    if (!isTieMode) return
    // Commit a slur handle drag.
    if (slurEdit) {
      const coords = getCoords(e) ?? { x: slurEdit.curX, y: slurEdit.curY }
      const current = ties.find(t => t.id === slurEdit.tieId)?.curve
      const patch = slurEditPatch(slurEdit, coords.x, coords.y, current)
      setSlurEdit(null)
      dispatch({ type: 'UPDATE_TIE_CURVE', partId, tieId: slurEdit.tieId, curve: patch })
      return
    }
    if (!tieDrag) return
    const coords = getCoords(e)
    const target = coords ? nearestNoteAtX(coords.x) : null
    setTieDrag(null)
    if (!target || target.id === tieDrag.fromId) return
    const newTies = computeTieSpans(measures, tieDrag.fromId, target.id)
    if (newTies.length === 0) return
    dispatch({ type: 'ADD_TIES', partId, ties: newTies })
    onTieComplete?.()
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (measures.length === 0) return
    if (isDeleteMode) return
    if (isFillMode) {
      const coords = getCoords(e)
      if (!coords) return
      const measure = measures[getMeasureIndexAtX(coords.x)]
      if (!measure) return
      dispatch({ type: 'FILL_MEASURE_RESTS', partId, measureId: measure.id })
      onFillComplete?.()
      return
    }
    if (isTieMode) return

    const coords = getCoords(e)
    if (!coords) return

    // Insert mode: clicking a gap locks it and opens the scratch staff.
    if (isInsertMode) {
      if (insertSession) return  // already building — use ✓ / ✗
      const session = gapAtX(getMeasureIndexAtX(coords.x), coords.x)
      if (session && measures[session.measureIndex]) { setInsertSession(session); setInsertHover(null) }
      return
    }

    // Chord add: click within CHORD_PROXIMITY_X of an existing note → ADD_CHORD_NOTE.
    if (!isRest) {
      const nearNote = nearestNoteAtX(coords.x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const pitch = staffYToPitch(coords.y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          dispatch({ type: 'ADD_CHORD_NOTE', partId, measureId: measure.id, noteId: nearNote.id, pitch: finalPitch })
          onNotePlaced?.()
        }
        return
      }

      // Replace-on-rest: click within CHORD_PROXIMITY_X of a rest → swap it for a note.
      const nearRest = nearestRestAtX(coords.x)
      if (nearRest) {
        const pitch = staffYToPitch(coords.y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = measures[nearRest.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearRest.measureIndex
          dispatch({
            type: 'REPLACE_REST',
            partId,
            measureId: measure.id,
            restId: nearRest.id,
            note: { id: crypto.randomUUID(), type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false },
          })
          onNotePlaced?.()
        }
        return
      }
    }

    const idx = getMeasureIndexAtX(coords.x)
    const measure = measures[idx]
    if (!measure) return

    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (!noteCanFit(measure, candidate, timeSig)) return
    pendingCenterRef.current = idx

    if (isRest) {
      dispatch({
        type: 'ADD_REST',
        partId,
        measureId: measure.id,
        rest: { id: crypto.randomUUID(), type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 },
      })
      onNotePlaced?.()
    } else {
      const pitch = staffYToPitch(coords.y, STAVE_Y, clef)
      const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
      dispatch({
        type: 'ADD_NOTE',
        partId,
        measureId: measure.id,
        note: {
          id: crypto.randomUUID(),
          type: 'note',
          pitches: [finalPitch],
          duration: selectedDuration,
          dots: isDotted ? 1 : 0,
          tied: false,
        },
      })
      onNotePlaced?.()
    }
  }

  const measureOverlays = layout?.measures.map((g, i) => {
    const measure = measures[i]
    if (!measure) return null
    const beatCount = measureBeatCount(measure)
    if (beatCount < 0.001) return null
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

  // Tempo mark overlays — rendered above the stave.
  const tempoOverlays = layout?.tempoMarks.map(tm => {
    const gIdx = layout.measures.findIndex((_, i) => measures[i]?.number === tm.measureNumber)
    const g = gIdx !== -1 ? layout.measures[gIdx] : layout.measures.find((_, i) => measures[i] !== undefined)
    if (!g) return null
    return (
      <div
        key={`tempo-${tm.measureNumber}`}
        className="absolute pointer-events-none select-none"
        style={{ left: tm.x + 4, top: STAVE_Y - 22, zIndex: 10 }}
      >
        <span className="text-[11px] text-black/70 font-medium">♩ = {tm.tempo}</span>
      </div>
    )
  })

  return (
    <div className="relative">
    <div
      ref={el => { scrollRef.current = el; scrollSync?.register(el) }}
      onScroll={() => { if (scrollRef.current) { scrollSync?.onScroll(scrollRef.current); setScrollLeft(scrollRef.current.scrollLeft) } }}
      className={
        'bg-white rounded-lg p-4 block w-full select-none overflow-x-auto ' +
        (isTieMode || isFillMode || isDeleteMode || isInsertMode ? 'cursor-pointer' : 'cursor-crosshair')
      }
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHoverInfo(null); setTieDrag(null); setHoverMeasure(null); if (!insertSession) setInsertHover(null); endErase() }}
    >
      <div className="relative inline-block">
        <div ref={containerRef} />

        {measureOverlays}
        {tempoOverlays}

        {/* Red highlights: marked-for-delete (during drag) and pending rests (after release) */}
        {layout?.notes.map(n => {
          const isMarked = markedIds.has(n.id)
          const isPending = pendingRestIds?.has(n.id)
          if (!isMarked && !isPending) return null
          return (
            <div
              key={`red-${n.id}`}
              className="absolute pointer-events-none rounded-full"
              style={{
                left: n.x - 10,
                top: n.y - 10,
                width: 20,
                height: 20,
                background: 'rgba(239,68,68,0.30)',
                boxShadow: '0 0 10px 4px rgba(239,68,68,0.35)',
                zIndex: 18,
              }}
            />
          )
        })}

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

        {tieDrag && (
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}
          >
            <line
              x1={tieDrag.fromX} y1={tieDrag.fromY}
              x2={tieDrag.curX} y2={tieDrag.curY}
              stroke="rgba(139,92,246,0.8)" strokeWidth={2} strokeDasharray="4 3"
            />
            <circle cx={tieDrag.fromX} cy={tieDrag.fromY} r={4} fill="rgba(139,92,246,0.9)" />
          </svg>
        )}

        {/* Replace-on-rest target: ring the rest the next click will overwrite. */}
        {hoverInfo?.restTarget && !isRest && !isTieMode && !isDeleteMode && !isInsertMode && (
          <div
            className="absolute pointer-events-none rounded-md"
            style={{
              left: hoverInfo.restTarget.x - 12,
              top: hoverInfo.restTarget.y - 16,
              width: 24,
              height: 32,
              border: '1.5px solid rgba(139,92,246,0.7)',
              background: 'rgba(139,92,246,0.10)',
              zIndex: 16,
            }}
          />
        )}

        {hoverInfo && !isRest && !isTieMode && !isDeleteMode && !isInsertMode && (
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: hoverInfo.x - DOT_R,
              top: hoverInfo.snapY - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              // Chord target: amber; new note: violet
              background: hoverInfo.isChordTarget
                ? 'rgba(251,191,36,0.85)'
                : 'rgba(139,92,246,0.75)',
              boxShadow: hoverInfo.isChordTarget
                ? '0 0 14px 7px rgba(251,191,36,0.30)'
                : '0 0 14px 7px rgba(139,92,246,0.35)',
              zIndex: 20,
            }}
          />
        )}

        {/* Slur edit handles (tie mode) — only for ties whose measure(s) the cursor
            is over, so handles don't clutter unrelated measures. The tie being
            dragged stays visible regardless. */}
        {isTieMode && layout?.ties.flatMap(geo => {
          const editing = slurEdit?.tieId === geo.id
          const startM = getMeasureIndexAtX(geo.startX)
          const endM = getMeasureIndexAtX(geo.endX)
          const hovered = hoverMeasure !== null && hoverMeasure >= startM && hoverMeasure <= endM
          if (!editing && !hovered) return []
          const pts = slurHandlePoints(geo)
          return (['start', 'end', 'apex'] as const).map(h => {
            const live = editing && slurEdit!.handle === h
            const cx = live ? slurEdit!.curX : pts[h].x
            const cy = live ? slurEdit!.curY : pts[h].y
            const apex = h === 'apex'
            return (
              <div
                key={geo.id + h}
                className="absolute rounded-full"
                style={{
                  left: cx - SLUR_HANDLE_R / 2,
                  top: cy - SLUR_HANDLE_R / 2,
                  width: SLUR_HANDLE_R,
                  height: SLUR_HANDLE_R,
                  background: apex ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.55)',
                  border: '1.5px solid white',
                  boxShadow: '0 0 6px rgba(139,92,246,0.5)',
                  cursor: 'grab',
                  zIndex: 28,
                }}
              />
            )
          })
        })}

        {/* Delete brush trail */}
        {isDeleteMode && trail.length > 0 && (
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 30, overflow: 'visible' }}
          >
            {trail.map((p, i) => {
              const age = (performance.now() - p.born) / TRAIL_MS
              const op = Math.max(0, 1 - age)
              const r = 2 + op * 7
              return <circle key={`${p.born}-${i}`} cx={p.x} cy={p.y} r={r} fill={`rgba(239,68,68,${op * 0.5})`} />
            })}
          </svg>
        )}

        {/* Insert-mode gap marker (hover preview + locked position) */}
        {isInsertMode && (insertSession ?? insertHover) && (
          <div
            className="absolute pointer-events-none select-none font-bold leading-none"
            style={{
              left: (insertSession ?? insertHover)!.anchorX - 7,
              top: STAVE_TOP_Y - 20,
              color: insertSession ? 'rgba(139,92,246,1)' : 'rgba(139,92,246,0.6)',
              fontSize: 18,
              zIndex: 22,
            }}
          >
            ⌄
          </div>
        )}
      </div>
    </div>

      {/* Scratch staff for the locked insertion point. Lives outside the
          horizontally-scrolling card so it can flow up into the page instead of
          being clipped by the card's top edge; it tracks horizontal scroll via scrollLeft. */}
      {isInsertMode && insertSession && measures[insertSession.measureIndex] && (
        <InsertStaff
          left={CARD_PAD - 4 + insertSession.anchorX - scrollLeft}
          top={CARD_PAD + STAVE_TOP_Y - 96 - 16}
          capacity={measureRemainingBeats(measures[insertSession.measureIndex], timeSig)}
          timeSig={timeSig}
          keySig={keySig}
          clef={clef}
          selectedDuration={selectedDuration}
          selectedAccidental={selectedAccidental}
          isDotted={isDotted}
          isRest={isRest}
          onCommit={commitInsert}
          onCancel={() => { setInsertSession(null); onInsertComplete?.() }}
        />
      )}
    </div>
  )
}
