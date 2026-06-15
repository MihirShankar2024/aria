import { useEffect, useRef, useState } from 'react'
import { renderStaff, type StaffLayout, type NoteGeometry } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, noteHasPitchAtStaffY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, isMeasureFull, noteCanFit, measureRemainingBeats } from '../../lib/beats'
import { computeTieSpans } from '../../lib/ties'
import { InsertStaff } from './InsertStaff'
import type { ScrollSync } from '../../hooks/useScrollSync'
import type { PlaybackLayout } from '../../hooks/usePlaybackScroll'
import { slurHandlePoints, hitSlurHandle, slurEditPatch, SLUR_HANDLE_R, type SlurEdit } from './slurEditing'
import { useDeleteTrail, TRAIL_MS, type PendingRest } from './useDeleteTrail'
import { applyRestErase } from '../../lib/rests'
import type { Measure, TimeSig, KeySig, Duration, Accidental, Tie, Clef, Note, NoteEvent } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const STAVE_Y = 48
const DOT_R = 7
const CHORD_PROXIMITY_X = 20  // px — click within this of an existing note's x-center → chord add
const BRUSH_R = 15            // px radius of the delete brush
const NOTEHEAD_HIT_R = 12     // px — precise click radius on a notehead (apply dot/accidental)

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
  isSelectMode?: boolean
  selectedNoteIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  onNotePlaced?: () => void
  onTieComplete?: () => void
  onFillComplete?: () => void
  onInsertComplete?: () => void
  onRestsCommitted?: (pending: PendingRest[]) => void
  onPlaybackLayoutChange?: (layout: PlaybackLayout) => void
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
  noteTarget: { x: number; y: number } | null  // (rest mode) the note this click would replace
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
  isSelectMode = false,
  selectedNoteIds,
  onSelectionChange,
  onNotePlaced,
  onTieComplete,
  onFillComplete,
  onInsertComplete,
  onRestsCommitted,
  onPlaybackLayoutChange,
}: StaffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [layout, setLayout] = useState<StaffLayout | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const isSelectingRef = useRef(false)
  const [tieDrag, setTieDrag] = useState<TieDrag | null>(null)
  const [slurEdit, setSlurEdit] = useState<SlurEdit | null>(null)
  const [hoverMeasure, setHoverMeasure] = useState<number | null>(null)
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set())
  const [insertHover, setInsertHover] = useState<InsertSession | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  // Keyboard adjustment: arrow keys nudge the cursor away from the raw mouse position.
  // Moving the mouse resets these back to null (mouse takes over again).
  const [keyboardCursor, setKeyboardCursor] = useState<{
    stepsDown: number   // overrides the mouse-derived stepsDown when set
    x: number           // overrides the mouse x when set
    measureIndex: number
    // When the cursor is sitting on a note/rest, anchor to its id so the x can be
    // re-derived from the note's center after layout reflows (adds/chords shift it).
    anchorId?: string
    // When the cursor is parked past the last note (the empty end slot), track it so
    // it stays pinned to the measure's end after the measure shifts/expands.
    atEnd?: boolean
  } | null>(null)
  const keyboardCursorRef = useRef(keyboardCursor)
  keyboardCursorRef.current = keyboardCursor

  const markingRef = useRef(false)
  const markedRef = useRef<Set<string>>(new Set())  // synchronous mirror of markedIds
  const clickCooldownRef = useRef(0)
  const pendingCenterRef = useRef<number | null>(null)
  // Stable refs so the once-subscribed keydown handler never reads stale values.
  const layoutRef = useRef<StaffLayout | null>(null)
  layoutRef.current = layout
  const hoverInfoRef = useRef<HoverInfo | null>(null)
  hoverInfoRef.current = hoverInfo
  const mouseInStaffRef = useRef(false)
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

  useEffect(() => {
    if (!layout || !onPlaybackLayoutChange) return
    onPlaybackLayoutChange({ measures: layout.measures, notes: layout.notes })
  }, [layout, onPlaybackLayoutChange])

  // After a reflow (e.g. first note in a bar, or adding a chord tone) a note's
  // visual center shifts. If the keyboard cursor is anchored to that note, snap its
  // x to the new center so the user stays "on" the note instead of just beside it.
  useEffect(() => {
    if (!layout) return
    const kc = keyboardCursorRef.current
    if (!kc) return
    if (kc.anchorId) {
      const note = layout.notes.find(n => n.id === kc.anchorId)
      if (!note) return
      if (Math.abs(note.cx - kc.x) > 0.5 || note.measureIndex !== kc.measureIndex) {
        setKeyboardCursor({ ...kc, x: note.cx, measureIndex: note.measureIndex })
      }
      return
    }
    if (kc.atEnd) {
      const g = layout.measures[kc.measureIndex]
      if (!g) return
      const endX = g.x + g.width - 16
      if (Math.abs(endX - kc.x) > 0.5) setKeyboardCursor({ ...kc, x: endX })
    }
  }, [layout])

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

  // Leaving tie mode abandons any in-progress slur drag or handle edit.
  useEffect(() => {
    if (!isTieMode) { setTieDrag(null); setSlurEdit(null) }
  }, [isTieMode])

  // Entering select mode drops the edit cursor so it doesn't stay frozen on the staff.
  useEffect(() => {
    if (isSelectMode) { setHoverInfo(null); setKeyboardCursor(null) }
  }, [isSelectMode])

  // Arrow-key cursor: works whenever the mouse is inside this staff (no click needed).
  // Mouse movement resets the keyboard adjustment — the two coexist, last one wins.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only active when the mouse is inside this staff canvas.
      if (!mouseInStaffRef.current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return

      const currentLayout = layoutRef.current
      const hover = hoverInfoRef.current

      // Derive the current cursor: keyboard adjustment if active, else raw mouse hover.
      const baseCursor = (() => {
        if (keyboardCursorRef.current) return keyboardCursorRef.current
        if (!hover || !currentLayout) return null
        const stepsDown = Math.round((hover.snapY - STAVE_TOP_Y) / (LINE_SPACING / 2))
        const mIdx = (() => {
          for (let i = 0; i < currentLayout.measures.length; i++) {
            const g = currentLayout.measures[i]
            if (hover.x >= g.x && hover.x < g.x + g.width) return i
          }
          return currentLayout.measures.length - 1
        })()
        return { stepsDown, x: hover.x, measureIndex: mIdx }
      })()

      if (!baseCursor) return

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          setKeyboardCursor({ ...baseCursor, stepsDown: baseCursor.stepsDown - 1 })
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          setKeyboardCursor({ ...baseCursor, stepsDown: baseCursor.stepsDown + 1 })
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (!currentLayout) break
          const mIdx = baseCursor.measureIndex
          const notesInM = currentLayout.notes
            .filter(n => n.measureIndex === mIdx)
            .sort((a, b) => a.x - b.x)
          const prev = [...notesInM].reverse().find(n => n.cx < baseCursor.x - 1)
          if (prev) {
            setKeyboardCursor({ ...baseCursor, x: prev.cx, anchorId: prev.id, atEnd: false })
            break
          }
          // At the left edge: cross into the previous measure (its last note, or end slot).
          const prevG = currentLayout.measures[mIdx - 1]
          if (prevG) {
            const prevNotes = currentLayout.notes
              .filter(n => n.measureIndex === mIdx - 1)
              .sort((a, b) => a.cx - b.cx)
            const last = prevNotes[prevNotes.length - 1]
            const targetX = last ? last.cx : prevG.x + prevG.width - 16
            setKeyboardCursor({ ...baseCursor, x: targetX, measureIndex: mIdx - 1, anchorId: last?.id, atEnd: !last })
          }
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (!currentLayout) break
          const mIdx = baseCursor.measureIndex
          const g = currentLayout.measures[mIdx]
          const notesInM = currentLayout.notes
            .filter(n => n.measureIndex === mIdx)
            .sort((a, b) => a.x - b.x)
          const next = notesInM.find(n => n.cx > baseCursor.x + 1)
          if (next) {
            setKeyboardCursor({ ...baseCursor, x: next.cx, anchorId: next.id, atEnd: false })
            break
          }
          // No further note in this measure: first land on the empty end slot,
          // then a second press crosses into the next measure.
          const endSlotX = g ? g.x + g.width - 16 : baseCursor.x
          if (baseCursor.x < endSlotX - 1) {
            setKeyboardCursor({ ...baseCursor, x: endSlotX, anchorId: undefined, atEnd: true })
            break
          }
          const nextG = currentLayout.measures[mIdx + 1]
          if (nextG) {
            const nextNotes = currentLayout.notes
              .filter(n => n.measureIndex === mIdx + 1)
              .sort((a, b) => a.cx - b.cx)
            const first = nextNotes[0]
            const targetX = first ? first.cx : nextG.x + 16
            setKeyboardCursor({ ...baseCursor, x: targetX, measureIndex: mIdx + 1, anchorId: first?.id, atEnd: false })
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          const snapY = staffStepToY(baseCursor.stepsDown, STAVE_Y)
          const placedId = placeAtRef.current(baseCursor.x, snapY)
          // If parked at the end slot, stay at the end (so you can keep adding, or
          // press Left to reach the note just placed). Otherwise anchor to the
          // placed/modified note so the cursor follows it through the reflow.
          if (placedId && !baseCursor.atEnd) {
            setKeyboardCursor({ ...baseCursor, anchorId: placedId, atEnd: false })
          }
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  // Find the note whose notehead sits directly under (x, y) — a precise hit on the
  // glyph, not just the same column (used by the dot/accidental click-to-apply path).
  const noteHeadAt = (x: number, y: number): NoteGeometry | null => {
    if (!layout) return null
    const r2 = NOTEHEAD_HIT_R * NOTEHEAD_HIT_R
    let best: NoteGeometry | null = null
    let bestDist = r2
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      for (const ny of n.ys) {
        const d = (n.x - x) * (n.x - x) + (ny - y) * (ny - y)
        if (d <= bestDist) { bestDist = d; best = n }
      }
    }
    return best
  }

  // Apply the active modifier tool(s) — dot and/or accidental — to an existing note.
  // The accidental lands on the chord tone at the clicked staff position. onNotePlaced
  // then clears the tool selection (so it doesn't carry to the next placement).
  const applyModifierToExistingNote = (target: NoteGeometry, clickY: number) => {
    const measure = measures[target.measureIndex]
    if (!measure) return
    const ev = measure.notes.find(n => n.id === target.id)
    if (!ev || ev.type !== 'note') return
    const patch: Partial<Note> = {}
    if (isDotted) patch.dots = 1
    if (selectedAccidental !== null) {
      const clicked = staffYToPitch(clickY, STAVE_Y, clef)
      patch.pitches = ev.pitches.map(p =>
        p.step === clicked.step && p.octave === clicked.octave
          ? { ...p, accidental: selectedAccidental }
          : p,
      )
    }
    if (Object.keys(patch).length === 0) return
    pendingCenterRef.current = target.measureIndex
    dispatch({ type: 'UPDATE_NOTE', partId, measureId: measure.id, noteId: target.id, patch })
    onNotePlaced?.()
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

  const commitSelection = (box: { startX: number; startY: number; endX: number; endY: number }) => {
    isSelectingRef.current = false
    setSelectionBox(null)
    if (!layout) return
    const minX = Math.min(box.startX, box.endX)
    const maxX = Math.max(box.startX, box.endX)
    const minY = Math.min(box.startY, box.endY)
    const maxY = Math.max(box.startY, box.endY)
    // Tiny box = click without drag: clear selection
    if (maxX - minX < 3 && maxY - minY < 3) {
      onSelectionChange?.(new Set())
      return
    }
    const ids = new Set<string>()
    for (const n of layout.notes) {
      if (n.x < minX || n.x > maxX) continue
      if (n.ys.some(y => y >= minY && y <= maxY)) ids.add(n.id)
    }
    onSelectionChange?.(ids)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSelectMode) {
      const coords = getCoords(e)
      if (!coords) return
      if (isSelectingRef.current) setSelectionBox(prev => prev ? { ...prev, endX: coords.x, endY: coords.y } : null)
      return
    }
    if (isDeleteMode) {
      const coords = getCoords(e)
      if (!coords) return
      pushTrail(coords.x, coords.y, markingRef.current)
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
    const coords = getCoords(e)
    if (!coords) return
    // Mouse moving resets any keyboard adjustment — mouse has priority again.
    setKeyboardCursor(null)
    const stepsDown = Math.round((coords.y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    // In rest mode the cursor still follows the mouse vertically (purely visual —
    // pitch is irrelevant for rests), so it doesn't feel frozen on one line.
    if (isRest) {
      const nearNote = nearestNoteAtX(coords.x, CHORD_PROXIMITY_X)
      setHoverInfo({ x: coords.x, snapY, isChordTarget: false, restTarget: null, noteTarget: nearNote ? { x: nearNote.cx, y: nearNote.y } : null })
      return
    }
    const nearNote = nearestNoteAtX(coords.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(coords.x)
    setHoverInfo({ x: coords.x, snapY, isChordTarget: !!nearNote, restTarget: nearRest ? { x: nearRest.cx, y: nearRest.y } : null, noteTarget: null })
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return
    if (isSelectMode) {
      isSelectingRef.current = true
      setSelectionBox({ startX: coords.x, startY: coords.y, endX: coords.x, endY: coords.y })
      return
    }
    if (isDeleteMode) {
      if (performance.now() < clickCooldownRef.current) return
      markingRef.current = true
      pushTrail(coords.x, coords.y, true)
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
    if (isSelectMode) {
      if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      return
    }
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

  // Core placement logic shared by mouse click and Enter key. Returns the id of the
  // note/rest that was placed or modified (so the keyboard cursor can anchor to it).
  const placeAt = (x: number, y: number): string | null => {
    if (measures.length === 0) return null
    // Dot/accidental tool: apply to an existing note when aimed at one of its tones.
    // 1) precise notehead hit; 2) chord column + same staff line/space as a chord tone.
    // Otherwise fall through (e.g. chord column on a new line → ADD_CHORD_NOTE below).
    if (!isRest && (isDotted || selectedAccidental !== null)) {
      const hit = noteHeadAt(x, y)
      if (hit) { applyModifierToExistingNote(hit, y); return hit.id }
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = measures[nearNote.measureIndex]
        const ev = measure?.notes.find(n => n.id === nearNote.id)
        if (ev?.type === 'note' && noteHasPitchAtStaffY(ev.pitches, y, STAVE_Y, clef)) {
          applyModifierToExistingNote(nearNote, y)
          return nearNote.id
        }
      }
    }
    if (!isRest) {
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const pitch = staffYToPitch(y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          dispatch({ type: 'ADD_CHORD_NOTE', partId, measureId: measure.id, noteId: nearNote.id, pitch: finalPitch })
          onNotePlaced?.()
          return nearNote.id
        }
        return null
      }
      const nearRest = nearestRestAtX(x)
      if (nearRest) {
        const pitch = staffYToPitch(y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = measures[nearRest.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearRest.measureIndex
          const newId = crypto.randomUUID()
          dispatch({
            type: 'REPLACE_REST',
            partId,
            measureId: measure.id,
            restId: nearRest.id,
            note: { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false },
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
    } else {
      // Rest mode: clicking an existing note replaces it with a rest — mirror of
      // replacing a rest with a note above.
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          const newId = crypto.randomUUID()
          dispatch({
            type: 'REPLACE_EVENT',
            partId,
            measureId: measure.id,
            eventId: nearNote.id,
            event: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 },
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
    }
    const idx = getMeasureIndexAtX(x)
    const measure = measures[idx]
    if (!measure) return null
    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (!noteCanFit(measure, candidate, timeSig)) return null
    pendingCenterRef.current = idx
    const newId = crypto.randomUUID()
    if (isRest) {
      dispatch({ type: 'ADD_REST', partId, measureId: measure.id, rest: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 } })
      onNotePlaced?.()
    } else {
      const pitch = staffYToPitch(y, STAVE_Y, clef)
      const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
      dispatch({ type: 'ADD_NOTE', partId, measureId: measure.id, note: { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false } })
      onNotePlaced?.()
    }
    return newId
  }
  // Stable ref so the keydown handler always calls the current closure.
  const placeAtRef = useRef(placeAt)
  placeAtRef.current = placeAt

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (measures.length === 0) return
    if (isSelectMode) return
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
      if (insertSession) return
      const session = gapAtX(getMeasureIndexAtX(coords.x), coords.x)
      if (session && measures[session.measureIndex]) { setInsertSession(session); setInsertHover(null) }
      return
    }

    placeAt(coords.x, coords.y)
  }

  // When keyboard cursor is active it overrides mouse hover for the ghost-dot display.
  const activeHover: HoverInfo | null = (() => {
    if (!keyboardCursor) return hoverInfo
    const snapY = staffStepToY(keyboardCursor.stepsDown, STAVE_Y)
    const nearNote = nearestNoteAtX(keyboardCursor.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(keyboardCursor.x)
    return {
      x: keyboardCursor.x,
      snapY,
      isChordTarget: !isRest && !!nearNote,
      restTarget: !isRest && nearRest ? { x: nearRest.cx, y: nearRest.y } : null,
      noteTarget: isRest && nearNote ? { x: nearNote.cx, y: nearNote.y } : null,
    }
  })()

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
      onMouseEnter={() => { mouseInStaffRef.current = true }}
      onMouseLeave={() => {
        mouseInStaffRef.current = false
        setHoverInfo(null); setTieDrag(null); setHoverMeasure(null); setKeyboardCursor(null)
        if (!insertSession) setInsertHover(null)
        endErase()
        if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      }}
    >
      <div className="relative inline-block">
        <div ref={containerRef} />

        {measureOverlays}
        {tempoOverlays}

        {/* Violet highlights for selected notes */}
        {selectedNoteIds && layout?.notes.map(n => {
          if (!selectedNoteIds.has(n.id)) return null
          return (
            <div
              key={`sel-${n.id}`}
              className="absolute pointer-events-none rounded-full"
              style={{
                left: n.x - 10,
                top: n.y - 10,
                width: 20,
                height: 20,
                background: 'rgba(139,92,246,0.30)',
                boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)',
                zIndex: 18,
              }}
            />
          )
        })}

        {/* Rubber-band selection box */}
        {isSelectMode && selectionBox && (
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}
          >
            <rect
              x={Math.min(selectionBox.startX, selectionBox.endX)}
              y={Math.min(selectionBox.startY, selectionBox.endY)}
              width={Math.abs(selectionBox.endX - selectionBox.startX)}
              height={Math.abs(selectionBox.endY - selectionBox.startY)}
              fill="rgba(139,92,246,0.08)"
              stroke="rgba(139,92,246,0.8)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          </svg>
        )}

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
        {activeHover?.restTarget && !isRest && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
          <div
            className="absolute pointer-events-none rounded-md"
            style={{
              left: activeHover.restTarget.x - 12,
              top: activeHover.restTarget.y - 16,
              width: 24,
              height: 32,
              border: '1.5px solid rgba(139,92,246,0.7)',
              background: 'rgba(139,92,246,0.10)',
              zIndex: 16,
            }}
          />
        )}

        {/* Replace-on-note target (rest mode): ring the note the next click will overwrite. */}
        {activeHover?.noteTarget && isRest && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
          <div
            className="absolute pointer-events-none rounded-md"
            style={{
              left: activeHover.noteTarget.x - 12,
              top: activeHover.noteTarget.y - 16,
              width: 24,
              height: 32,
              border: '1.5px solid rgba(139,92,246,0.7)',
              background: 'rgba(139,92,246,0.10)',
              zIndex: 16,
            }}
          />
        )}

        {activeHover && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: activeHover.x - DOT_R,
              top: activeHover.snapY - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              background: activeHover.isChordTarget
                ? 'rgba(251,191,36,0.85)'
                : 'rgba(139,92,246,0.75)',
              boxShadow: activeHover.isChordTarget
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
              const rgb = p.pressed ? '239,68,68' : '148,163,184'
              return <circle key={`${p.born}-${i}`} cx={p.x} cy={p.y} r={r} fill={`rgba(${rgb},${op * 0.5})`} />
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
