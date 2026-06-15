import { useEffect, useRef, useState } from 'react'
import {
  renderGrandStaff,
  type GrandStaffLayout,
  type NoteGeometry,
  GRAND_TREBLE_Y,
  GRAND_BASS_Y,
  GRAND_STAFF_HEIGHT,
} from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, noteHasPitchAtStaffY, whichGrandStaffStave, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, isMeasureFull, noteCanFit, measureRemainingBeats } from '../../lib/beats'
import { computeTieSpans } from '../../lib/ties'
import { InsertStaff } from './InsertStaff'
import type { ScrollSync } from '../../hooks/useScrollSync'
import type { PlaybackLayout } from '../../hooks/usePlaybackScroll'
import { slurHandlePoints, hitSlurHandle, slurEditPatch, SLUR_HANDLE_R, type SlurEdit } from './slurEditing'
import { hitGlyphHandle, GLYPH_HANDLE_R, type GlyphEdit } from './accidentalEditing'
import { useDeleteTrail, TRAIL_MS, type PendingRest } from './useDeleteTrail'
import { applyRestErase } from '../../lib/rests'
import { diatonicStep } from '../../lib/transposition/transpose'
import type { TimeSig, KeySig, Duration, Accidental, Part, Note, NoteEvent } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const DOT_R = 7
const CHORD_PROXIMITY_X = 20
const BRUSH_R = 15
const NOTEHEAD_HIT_R = 12     // px — precise click radius on a notehead (apply dot/accidental)

const TREBLE_TOP_Y    = GRAND_TREBLE_Y + STAVE_TOP_OFFSET
const TREBLE_BOTTOM_Y = TREBLE_TOP_Y + 4 * LINE_SPACING
const BASS_TOP_Y      = GRAND_BASS_Y + STAVE_TOP_OFFSET
const BASS_BOTTOM_Y   = BASS_TOP_Y + 4 * LINE_SPACING
const CARD_PAD = 16  // px — the card's p-4 padding; offsets content from the (unclipped) wrapper edge

interface HoverInfo { x: number; snapY: number; stave: 'treble' | 'bass'; isChordTarget: boolean; restTarget: { x: number; y: number } | null; noteTarget: { x: number; y: number } | null }
interface TieDrag { partId: string; fromId: string; fromX: number; fromY: number; curX: number; curY: number }

// A chosen insertion point on a specific stave.
interface InsertSession {
  stave: 'treble' | 'bass'
  measureIndex: number
  gapIndex: number
  anchorX: number
}

interface GrandStaffCanvasProps {
  treblePart: Part
  bassPart: Part
  timeSig: TimeSig
  keySig: KeySig
  dispatch: (action: ScoreAction) => void
  selectedDuration: Duration
  selectedAccidental: Accidental
  isDotted: boolean
  isRest: boolean
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

export function GrandStaffCanvas({
  treblePart,
  bassPart,
  timeSig,
  keySig,
  dispatch,
  selectedDuration,
  selectedAccidental,
  isDotted,
  isRest,
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
}: GrandStaffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<GrandStaffLayout | null>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [tieDrag, setTieDrag] = useState<TieDrag | null>(null)
  const [slurEdit, setSlurEdit] = useState<SlurEdit | null>(null)
  const [glyphEdit, setGlyphEdit] = useState<GlyphEdit | null>(null)
  const [hoverMeasure, setHoverMeasure] = useState<number | null>(null)
  // Set when a glyph-handle drag is committed on mouseup, so the trailing click doesn't place.
  const suppressClickRef = useRef(false)
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set())
  const [insertHover, setInsertHover] = useState<InsertSession | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const isSelectingRef = useRef(false)
  // Drag-move of selected notes in select mode (started on a notehead). deltaSteps is
  // the snapped vertical staff-position offset (down = positive) since the press.
  const [moveDrag, setMoveDrag] = useState<{ ids: string[]; hitId: string; startY: number; deltaSteps: number } | null>(null)

  const markingRef = useRef(false)
  const markedRef = useRef<Set<string>>(new Set())  // synchronous mirror of markedIds
  const clickCooldownRef = useRef(0)
  const pendingCenterRef = useRef<number | null>(null)
  const { trail, push: pushTrail } = useDeleteTrail(isDeleteMode)

  useEffect(() => {
    if (!containerRef.current) return
    try {
      const result = renderGrandStaff({
        container: containerRef.current,
        trebleMeasures: treblePart.measures,
        bassMeasures: bassPart.measures,
        timeSig,
        keySig,
        trebleTies: treblePart.ties ?? [],
        bassTies: bassPart.ties ?? [],
        initialTempo,
        tempoChanges,
        forcedStaveWidths,
      })
      setLayout(result)
    } catch (err) {
      console.error('Grand staff render failed', err)
    }
  }, [treblePart, bassPart, timeSig, keySig, initialTempo, tempoChanges, forcedStaveWidths])

  useEffect(() => {
    if (!layout || !onPlaybackLayoutChange) return
    onPlaybackLayoutChange({
      measures: layout.measures,
      notes: [...layout.trebleNotes, ...layout.bassNotes],
    })
  }, [layout, onPlaybackLayoutChange])

  // Smoothly recenter the active measure once it drifts into the right quarter.
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
    if (isSelectMode) setHoverInfo(null)
  }, [isSelectMode])

  // "Glyph adjust" mode: while an accidental or dot tool is active (and no other mode owns
  // the canvas), existing accidental/dot glyphs in the hovered measure expose drag handles.
  const isGlyphMode =
    !isSelectMode && !isDeleteMode && !isFillMode && !isTieMode && !isInsertMode &&
    (selectedAccidental !== null || isDotted)

  // Leaving glyph mode abandons any in-progress glyph drag.
  useEffect(() => {
    if (!isGlyphMode) setGlyphEdit(null)
  }, [isGlyphMode])

  const commitInsert = (events: NoteEvent[]) => {
    if (insertSession) {
      const part = insertSession.stave === 'treble' ? treblePart : bassPart
      const measure = part.measures[insertSession.measureIndex]
      if (measure && events.length > 0) {
        pendingCenterRef.current = insertSession.measureIndex
        dispatch({ type: 'INSERT_EVENTS', partId: part.id, measureId: measure.id, index: insertSession.gapIndex, events })
      }
    }
    setInsertSession(null)
    onInsertComplete?.()
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

  // Determine which stave a Y coordinate belongs to.
  const whichStave = (y: number): 'treble' | 'bass' => whichGrandStaffStave(y, GRAND_TREBLE_Y, GRAND_BASS_Y)

  const nearestNoteAtX = (notes: NoteGeometry[], x: number, maxDist = Infinity): NoteGeometry | null => {
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of notes) {
      if (n.type !== 'note') continue
      // Distance to the note's horizontal span (incl. accidentals), 0 when inside it.
      const d = x < n.leftX ? n.leftX - x : x > n.rightX ? x - n.rightX : 0
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  const nearestRestAtX = (notes: NoteGeometry[], x: number, maxDist = CHORD_PROXIMITY_X): NoteGeometry | null => {
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of notes) {
      if (n.type !== 'rest') continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  // Find the note whose notehead sits directly under (x, y) on a stave — a precise
  // hit on the glyph (used by the dot/accidental click-to-apply path).
  const noteHeadAt = (notes: NoteGeometry[], x: number, y: number): NoteGeometry | null => {
    const r2 = NOTEHEAD_HIT_R * NOTEHEAD_HIT_R
    let best: NoteGeometry | null = null
    let bestDist = r2
    for (const n of notes) {
      if (n.type !== 'note') continue
      for (const ny of n.ys) {
        const d = (n.x - x) * (n.x - x) + (ny - y) * (ny - y)
        if (d <= bestDist) { bestDist = d; best = n }
      }
    }
    return best
  }

  // Apply the active modifier tool(s) — dot and/or accidental — to an existing note,
  // the accidental landing on the chord tone at the clicked staff position. onNotePlaced
  // then clears the tool selection so it doesn't carry to the next placement.
  const applyModifierToExistingNote = (part: Part, staveY: number, clef: 'treble' | 'bass', target: NoteGeometry, clickY: number) => {
    const measure = part.measures[target.measureIndex]
    if (!measure) return
    const ev = measure.notes.find(n => n.id === target.id)
    if (!ev || ev.type !== 'note') return
    const patch: Partial<Note> = {}
    if (isDotted) patch.dots = 1
    if (selectedAccidental !== null) {
      const clicked = staffYToPitch(clickY, staveY, clef)
      patch.pitches = ev.pitches.map(p =>
        p.step === clicked.step && p.octave === clicked.octave
          ? { ...p, accidental: selectedAccidental }
          : p,
      )
    }
    if (Object.keys(patch).length === 0) return
    pendingCenterRef.current = target.measureIndex
    dispatch({ type: 'UPDATE_NOTE', partId: part.id, measureId: measure.id, noteId: target.id, patch })
    onNotePlaced?.()
  }

  // Resolve a cursor x to an insertion gap within a measure on the given stave.
  const gapAtX = (stave: 'treble' | 'bass', measureIndex: number, cursorX: number): InsertSession | null => {
    if (!layout) return null
    const g = layout.measures[measureIndex]
    if (!g) return null
    const notes = stave === 'treble' ? layout.trebleNotes : layout.bassNotes
    const xs = notes.filter(n => n.measureIndex === measureIndex).map(n => n.x).sort((a, b) => a - b)
    const gapIndex = xs.filter(x => x < cursorX).length
    const leftX = gapIndex === 0 ? g.x + 8 : xs[gapIndex - 1]
    const rightX = gapIndex === xs.length ? g.x + g.width - 8 : xs[gapIndex]
    return { stave, measureIndex, gapIndex, anchorX: (leftX + rightX) / 2 }
  }

  // Mark (don't delete) every note/rest under the brush across both staves.
  const markAt = (x: number, y: number) => {
    if (!layout) return
    const r2 = BRUSH_R * BRUSH_R
    let added = false
    for (const notes of [layout.trebleNotes, layout.bassNotes]) {
      for (const n of notes) {
        if (markedRef.current.has(n.id)) continue
        const dx = n.x - x
        // Hit any notehead in a chord (or the rest glyph), not just the lowest.
        if (!n.ys.some(ny => dx * dx + (ny - y) * (ny - y) <= r2)) continue
        markedRef.current.add(n.id); added = true
      }
    }
    if (added) setMarkedIds(new Set(markedRef.current))
  }

  // On release, convert marked notes to in-place rests across both staves.
  const commitMarks = () => {
    markingRef.current = false
    const marked = markedRef.current
    markedRef.current = new Set()
    setMarkedIds(new Set())
    if (marked.size === 0 || !layout) return
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    const pending: PendingRest[] = []
    const removedIds: string[] = []
    const lanes: [NoteGeometry[], Part][] = [
      [layout.trebleNotes, treblePart],
      [layout.bassNotes, bassPart],
    ]
    for (const [notes, part] of lanes) {
      const byMeasure = new Map<number, Set<string>>()
      for (const n of notes) {
        if (!marked.has(n.id)) continue
        const set = byMeasure.get(n.measureIndex) ?? new Set<string>()
        set.add(n.id)
        byMeasure.set(n.measureIndex, set)
      }
      for (const [mIdx, ids] of byMeasure) {
        const measure = part.measures[mIdx]
        if (!measure) continue
        for (const id of ids) if (measure.notes.find(n => n.id === id)?.type === 'note') removedIds.push(id)
        // Keep already-pending red rests in this measure highlighted across deletes.
        for (const ev of measure.notes) if (pendingRestIds?.has(ev.id)) ids.add(ev.id)
        const { notes: newNotes, redRestIds } = applyRestErase(measure.notes, ids, measure.timeSig ?? timeSig)
        edits.push({ partId: part.id, measureId: measure.id, notes: newNotes })
        if (redRestIds.length) pending.push({ partId: part.id, measureId: measure.id, restIds: redRestIds })
      }
    }
    if (edits.length === 0) return
    dispatch({ type: 'APPLY_MEASURE_NOTES', edits, removedIds })
    onRestsCommitted?.(pending)
  }

  const allTieHandles = (): { partId: string; ties: NonNullable<typeof layout>['trebleTies'] }[] =>
    layout
      ? [
          { partId: treblePart.id, ties: layout.trebleTies },
          { partId: bassPart.id, ties: layout.bassTies },
        ]
      : []

  // Accidental/dot glyph handles per stave, paired with their part and note geometry.
  const allGlyphHandles = () =>
    layout
      ? [
          { part: treblePart, glyphs: layout.trebleGlyphs, notes: layout.trebleNotes },
          { part: bassPart, glyphs: layout.bassGlyphs, notes: layout.bassNotes },
        ]
      : []

  const commitSelection = (box: { startX: number; startY: number; endX: number; endY: number }) => {
    isSelectingRef.current = false
    setSelectionBox(null)
    if (!layout) return
    const minX = Math.min(box.startX, box.endX)
    const maxX = Math.max(box.startX, box.endX)
    const minY = Math.min(box.startY, box.endY)
    const maxY = Math.max(box.startY, box.endY)
    if (maxX - minX < 3 && maxY - minY < 3) {
      onSelectionChange?.(new Set())
      return
    }
    const ids = new Set<string>()
    for (const notes of [layout.trebleNotes, layout.bassNotes]) {
      for (const n of notes) {
        if (n.x < minX || n.x > maxX) continue
        if (n.ys.some(y => y >= minY && y <= maxY)) ids.add(n.id)
      }
    }
    onSelectionChange?.(ids)
  }

  // A notehead hit on either stave (for click-select / drag-move in select mode).
  const noteHeadAtAny = (x: number, y: number): NoteGeometry | null =>
    noteHeadAt(layout?.trebleNotes ?? [], x, y) ?? noteHeadAt(layout?.bassNotes ?? [], x, y)

  // Snapped vertical staff-position delta (each line/space = one step), down = positive.
  const snapDeltaSteps = (y: number, startY: number) =>
    Math.round((y - startY) / (LINE_SPACING / 2))

  // Commit a drag-move: shift every selected note diatonically by the snapped delta
  // (dragging down lowers pitch) across both parts, in one undo-able edit.
  const commitMove = (drag: { ids: string[]; deltaSteps: number }) => {
    if (drag.deltaSteps === 0) return
    const idset = new Set(drag.ids)
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    for (const part of [treblePart, bassPart]) {
      for (const measure of part.measures) {
        if (!measure.notes.some(n => n.type === 'note' && idset.has(n.id))) continue
        const notes = measure.notes.map(ev =>
          ev.type === 'note' && idset.has(ev.id)
            ? { ...ev, pitches: ev.pitches.map(p => diatonicStep(p, -drag.deltaSteps)) }
            : ev,
        )
        edits.push({ partId: part.id, measureId: measure.id, notes })
      }
    }
    if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSelectMode) {
      const coords = getCoords(e)
      if (!coords) return
      if (moveDrag) {
        const d = snapDeltaSteps(coords.y, moveDrag.startY)
        if (d !== moveDrag.deltaSteps) setMoveDrag({ ...moveDrag, deltaSteps: d })
        return
      }
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
      setInsertHover(coords ? gapAtX(whichStave(coords.y), getMeasureIndexAtX(coords.x), coords.x) : null)
      return
    }
    if (isGlyphMode) {
      const c = getCoords(e)
      setHoverMeasure(c ? getMeasureIndexAtX(c.x) : null)
      if (glyphEdit && c) { setGlyphEdit({ ...glyphEdit, curX: c.x, curY: c.y }); return }
      // fall through so the placement ghost cursor keeps following the mouse
    }
    const coords = getCoords(e)
    if (!coords) return
    const stave = whichStave(coords.y)
    const staveY = stave === 'treble' ? GRAND_TREBLE_Y : GRAND_BASS_Y
    const stepsDown = Math.round((coords.y - (staveY + STAVE_TOP_OFFSET)) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, staveY)
    const notes = stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    if (isRest) {
      const nearNote = nearestNoteAtX(notes, coords.x, CHORD_PROXIMITY_X)
      setHoverInfo({ x: coords.x, snapY, stave, isChordTarget: false, restTarget: null, noteTarget: nearNote ? { x: nearNote.cx, y: nearNote.y } : null })
      return
    }
    const nearNote = nearestNoteAtX(notes, coords.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(notes, coords.x)
    setHoverInfo({ x: coords.x, snapY, stave, isChordTarget: !!nearNote, restTarget: nearRest ? { x: nearRest.cx, y: nearRest.y } : null, noteTarget: null })
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return
    if (isSelectMode) {
      // Pressing on a notehead selects/drag-moves it; pressing empty staff rubber-bands.
      const hit = noteHeadAtAny(coords.x, coords.y)
      if (hit) {
        const ids = selectedNoteIds?.has(hit.id) ? [...selectedNoteIds] : [hit.id]
        if (!selectedNoteIds?.has(hit.id)) onSelectionChange?.(new Set([hit.id]))
        setMoveDrag({ ids, hitId: hit.id, startY: coords.y, deltaSteps: 0 })
        return
      }
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
    if (isGlyphMode) {
      // Grabbing an accidental/dot handle starts a move; otherwise fall through to placement.
      for (const { part, glyphs } of allGlyphHandles()) {
        const g = hitGlyphHandle(glyphs, coords.x, coords.y)
        if (!g) continue
        const measureId = part.measures.find(m => m.notes.some(n => n.id === g.noteId))?.id
        if (measureId) {
          setGlyphEdit({
            partId: part.id, measureId, noteId: g.noteId, pitchIndex: g.pitchIndex, kind: g.kind,
            downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y,
          })
          return
        }
      }
    }
    if (!isTieMode) return
    // Editing a placed slur takes priority over starting a new one.
    for (const { partId, ties } of allTieHandles()) {
      const hit = hitSlurHandle(ties, coords.x, coords.y)
      if (hit) {
        setSlurEdit({ partId, ...hit, downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y })
        return
      }
    }
    const stave = whichStave(coords.y)
    const notes = stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const note = nearestNoteAtX(notes, coords.x)
    if (!note) return
    const partId = stave === 'treble' ? treblePart.id : bassPart.id
    setTieDrag({ partId, fromId: note.id, fromX: note.x, fromY: note.y, curX: coords.x, curY: coords.y })
  }

  const endErase = () => {
    if (markingRef.current) {
      commitMarks()
      clickCooldownRef.current = performance.now() + 150
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    // Commit a glyph (accidental/dot) handle drag. X is stored relative to the notehead
    // anchor so the glyph stays pinned when other chord tones/accidentals are added.
    if (glyphEdit) {
      const coords = getCoords(e) ?? { x: glyphEdit.curX, y: glyphEdit.curY }
      const note = (layout?.trebleNotes ?? []).find(n => n.id === glyphEdit.noteId)
        ?? (layout?.bassNotes ?? []).find(n => n.id === glyphEdit.noteId)
      const moved = coords.x !== glyphEdit.downX || coords.y !== glyphEdit.downY
      setGlyphEdit(null)
      suppressClickRef.current = true
      if (note && moved) {
        dispatch({
          type: 'UPDATE_GLYPH_OFFSET', partId: glyphEdit.partId, measureId: glyphEdit.measureId,
          noteId: glyphEdit.noteId, pitchIndex: glyphEdit.pitchIndex, kind: glyphEdit.kind,
          ax: coords.x - note.x, dy: coords.y - glyphEdit.downY,
        })
      }
      return
    }
    if (isSelectMode) {
      if (moveDrag) {
        // No drag = a plain click: narrow the selection to the clicked note.
        if (moveDrag.deltaSteps !== 0) commitMove(moveDrag)
        else onSelectionChange?.(new Set([moveDrag.hitId]))
        setMoveDrag(null)
        return
      }
      if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      return
    }
    if (isDeleteMode) { endErase(); return }
    if (!isTieMode) return
    if (slurEdit) {
      const coords = getCoords(e) ?? { x: slurEdit.curX, y: slurEdit.curY }
      const part = slurEdit.partId === treblePart.id ? treblePart : bassPart
      const current = part.ties?.find(t => t.id === slurEdit.tieId)?.curve
      const patch = slurEditPatch(slurEdit, coords.x, coords.y, current)
      setSlurEdit(null)
      dispatch({ type: 'UPDATE_TIE_CURVE', partId: slurEdit.partId, tieId: slurEdit.tieId, curve: patch })
      return
    }
    if (!tieDrag) return
    const coords = getCoords(e)
    const stave = coords ? whichStave(coords.y) : null
    const notes = stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const target = coords ? nearestNoteAtX(notes, coords.x) : null
    const part = tieDrag.partId === treblePart.id ? treblePart : bassPart
    setTieDrag(null)
    if (!target || target.id === tieDrag.fromId) return
    const newTies = computeTieSpans(part.measures, tieDrag.fromId, target.id)
    if (newTies.length === 0) return
    dispatch({ type: 'ADD_TIES', partId: tieDrag.partId, ties: newTies })
    onTieComplete?.()
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // A glyph-handle drag just finished — swallow the synthesized click so it doesn't place.
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (isSelectMode || isTieMode || isDeleteMode) return
    const coords = getCoords(e)
    if (!coords) return
    const stave = whichStave(coords.y)
    const staveY = stave === 'treble' ? GRAND_TREBLE_Y : GRAND_BASS_Y
    const part = stave === 'treble' ? treblePart : bassPart
    const notes = stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const idx = getMeasureIndexAtX(coords.x)

    if (isFillMode) {
      const measure = part.measures[idx]
      if (!measure) return
      dispatch({ type: 'FILL_MEASURE_RESTS', partId: part.id, measureId: measure.id })
      onFillComplete?.()
      return
    }

    // Insert mode: clicking a gap locks it and opens the scratch staff.
    if (isInsertMode) {
      if (insertSession) return  // already building — use ✓ / ✗
      const session = gapAtX(stave, idx, coords.x)
      const sPart = stave === 'treble' ? treblePart : bassPart
      if (session && sPart.measures[session.measureIndex]) { setInsertSession(session); setInsertHover(null) }
      return
    }

    const clef = stave === 'treble' ? 'treble' : 'bass'

    // Dot/accidental tool: apply to an existing note when aimed at one of its tones.
    // 1) precise notehead hit; 2) chord column + same staff line/space as a chord tone.
    // Otherwise fall through (e.g. chord column on a new line → ADD_CHORD_NOTE below).
    if (!isRest && (isDotted || selectedAccidental !== null)) {
      const hit = noteHeadAt(notes, coords.x, coords.y)
      if (hit) { applyModifierToExistingNote(part, staveY, clef, hit, coords.y); return }
      const nearNote = nearestNoteAtX(notes, coords.x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = part.measures[nearNote.measureIndex]
        const ev = measure?.notes.find(n => n.id === nearNote.id)
        if (ev?.type === 'note' && noteHasPitchAtStaffY(ev.pitches, coords.y, staveY, clef)) {
          applyModifierToExistingNote(part, staveY, clef, nearNote, coords.y)
          return
        }
      }
    }

    // Chord add
    if (!isRest) {
      const nearNote = nearestNoteAtX(notes, coords.x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const pitch = staffYToPitch(coords.y, staveY, stave === 'treble' ? 'treble' : 'bass')
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = part.measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          dispatch({ type: 'ADD_CHORD_NOTE', partId: part.id, measureId: measure.id, noteId: nearNote.id, pitch: finalPitch })
          onNotePlaced?.()
        }
        return
      }

      // Replace-on-rest: click within CHORD_PROXIMITY_X of a rest → swap it for a note.
      const nearRest = nearestRestAtX(notes, coords.x)
      if (nearRest) {
        const pitch = staffYToPitch(coords.y, staveY, stave === 'treble' ? 'treble' : 'bass')
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = part.measures[nearRest.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearRest.measureIndex
          dispatch({
            type: 'REPLACE_REST',
            partId: part.id,
            measureId: measure.id,
            restId: nearRest.id,
            note: { id: crypto.randomUUID(), type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false },
          })
          onNotePlaced?.()
        }
        return
      }
    } else {
      // Rest mode: clicking an existing note replaces it with a rest — mirror of
      // replacing a rest with a note above.
      const nearNote = nearestNoteAtX(notes, coords.x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = part.measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          dispatch({
            type: 'REPLACE_EVENT',
            partId: part.id,
            measureId: measure.id,
            eventId: nearNote.id,
            event: { id: crypto.randomUUID(), type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 },
          })
          onNotePlaced?.()
        }
        return
      }
    }

    const measure = part.measures[idx]
    if (!measure) return
    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (!noteCanFit(measure, candidate, timeSig)) return
    pendingCenterRef.current = idx

    if (isRest) {
      dispatch({
        type: 'ADD_REST',
        partId: part.id,
        measureId: measure.id,
        rest: { id: crypto.randomUUID(), type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 },
      })
      onNotePlaced?.()
    } else {
      const pitch = staffYToPitch(coords.y, staveY, clef)
      const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
      dispatch({
        type: 'ADD_NOTE',
        partId: part.id,
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

  // Validity overlays for both staves
  const measureOverlays = layout?.measures.flatMap((g, i) => {
    const elems = []
    const tm = treblePart.measures[i]
    const bm = bassPart.measures[i]
    if (tm && measureBeatCount(tm) > 0.001) {
      const full = isMeasureFull(tm, timeSig)
      elems.push(
        <div key={`t-${i}`} className="absolute pointer-events-none" style={{
          left: g.x, top: TREBLE_TOP_Y, width: g.width, height: TREBLE_BOTTOM_Y - TREBLE_TOP_Y,
          background: full ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.10)',
          borderTop: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          borderBottom: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          zIndex: 5,
        }} />,
      )
    }
    if (bm && measureBeatCount(bm) > 0.001) {
      const full = isMeasureFull(bm, timeSig)
      elems.push(
        <div key={`b-${i}`} className="absolute pointer-events-none" style={{
          left: g.x, top: BASS_TOP_Y, width: g.width, height: BASS_BOTTOM_Y - BASS_TOP_Y,
          background: full ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.10)',
          borderTop: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          borderBottom: `1.5px solid ${full ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
          zIndex: 5,
        }} />,
      )
    }
    return elems
  })

  const tempoOverlays = layout?.tempoMarks.map(tm => (
    <div
      key={`tempo-${tm.measureNumber}`}
      className="absolute pointer-events-none select-none"
      style={{ left: tm.x + 4, top: GRAND_TREBLE_Y - 22, zIndex: 10 }}
    >
      <span className="text-[11px] text-black/70 font-medium">♩ = {tm.tempo}</span>
    </div>
  ))

  return (
    <div className="relative">
    <div
      ref={el => { scrollRef.current = el; scrollSync?.register(el) }}
      onScroll={() => { if (scrollRef.current) { scrollSync?.onScroll(scrollRef.current); setScrollLeft(scrollRef.current.scrollLeft) } }}
      className={
        'bg-white rounded-lg p-4 block w-full select-none overflow-x-auto ' +
        (isTieMode || isFillMode || isDeleteMode || isInsertMode ? 'cursor-pointer' : 'cursor-crosshair')
      }
      style={{ minHeight: GRAND_STAFF_HEIGHT + 32 }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        setHoverInfo(null); setTieDrag(null); setHoverMeasure(null)
        if (glyphEdit) setGlyphEdit(null)
        if (!insertSession) setInsertHover(null)
        endErase()
        if (moveDrag) { commitMove(moveDrag); setMoveDrag(null) }
        if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      }}
    >
      <div className="relative inline-block">
        <div ref={containerRef} />
        {measureOverlays}
        {tempoOverlays}

        {/* Violet highlights for selected notes */}
        {selectedNoteIds && layout && [...layout.trebleNotes, ...layout.bassNotes].map(n => {
          if (!selectedNoteIds.has(n.id)) return null
          const dy = moveDrag && moveDrag.ids.includes(n.id) ? moveDrag.deltaSteps * (LINE_SPACING / 2) : 0
          return (
            <div
              key={`sel-${n.id}`}
              className="absolute pointer-events-none rounded-full"
              style={{
                left: n.x - 10, top: n.y - 10 + dy, width: 20, height: 20,
                background: 'rgba(139,92,246,0.30)', boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)', zIndex: 18,
              }}
            />
          )
        })}

        {/* Rubber-band selection box */}
        {isSelectMode && selectionBox && (
          <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}>
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
        {layout && [...layout.trebleNotes, ...layout.bassNotes].map(n => {
          if (!markedIds.has(n.id) && !pendingRestIds?.has(n.id)) return null
          return (
            <div
              key={`red-${n.id}`}
              className="absolute pointer-events-none rounded-full"
              style={{
                left: n.x - 10, top: n.y - 10, width: 20, height: 20,
                background: 'rgba(239,68,68,0.30)', boxShadow: '0 0 10px 4px rgba(239,68,68,0.35)', zIndex: 18,
              }}
            />
          )
        })}

        {isFillMode && hoverMeasure !== null && layout?.measures[hoverMeasure] && (['treble', 'bass'] as const).map(stave => {
          const top  = stave === 'treble' ? TREBLE_TOP_Y : BASS_TOP_Y
          const h    = stave === 'treble' ? TREBLE_BOTTOM_Y - TREBLE_TOP_Y : BASS_BOTTOM_Y - BASS_TOP_Y
          return (
            <div key={stave} className="absolute pointer-events-none" style={{
              left: layout.measures[hoverMeasure].x, top, width: layout.measures[hoverMeasure].width, height: h,
              background: 'rgba(139,92,246,0.18)', border: '1.5px solid rgba(139,92,246,0.6)', zIndex: 15,
            }} />
          )
        })}

        {tieDrag && (
          <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}>
            <line x1={tieDrag.fromX} y1={tieDrag.fromY} x2={tieDrag.curX} y2={tieDrag.curY} stroke="rgba(139,92,246,0.8)" strokeWidth={2} strokeDasharray="4 3" />
            <circle cx={tieDrag.fromX} cy={tieDrag.fromY} r={4} fill="rgba(139,92,246,0.9)" />
          </svg>
        )}

        {/* Replace-on-note target (rest mode): ring the note the next click will overwrite. */}
        {hoverInfo?.noteTarget && isRest && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
          <div
            className="absolute pointer-events-none rounded-md"
            style={{
              left: hoverInfo.noteTarget.x - 12,
              top: hoverInfo.noteTarget.y - 16,
              width: 24,
              height: 32,
              border: '1.5px solid rgba(139,92,246,0.7)',
              background: 'rgba(139,92,246,0.10)',
              zIndex: 16,
            }}
          />
        )}

        {/* Replace-on-rest target: ring the rest the next click will overwrite. */}
        {hoverInfo?.restTarget && !isRest && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
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

        {hoverInfo && !isRest && !isTieMode && !isDeleteMode && !isInsertMode && !isSelectMode && (
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              left: hoverInfo.x - DOT_R,
              top: hoverInfo.snapY - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              background: hoverInfo.isChordTarget ? 'rgba(251,191,36,0.85)' : 'rgba(139,92,246,0.75)',
              boxShadow: hoverInfo.isChordTarget ? '0 0 14px 7px rgba(251,191,36,0.30)' : '0 0 14px 7px rgba(139,92,246,0.35)',
              zIndex: 20,
            }}
          />
        )}

        {/* Slur edit handles (tie mode) — only for ties whose measure(s) the cursor
            is over, so handles don't clutter unrelated measures. The tie being
            dragged stays visible regardless. */}
        {isTieMode && allTieHandles().flatMap(({ ties }) =>
          ties.flatMap(geo => {
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
          }),
        )}

        {/* Accidental/dot adjust handles — only for glyphs in the hovered measure. The
            glyph being dragged follows the cursor. */}
        {isGlyphMode && allGlyphHandles().flatMap(({ glyphs, notes }) =>
          glyphs.map(g => {
            const editing = glyphEdit?.noteId === g.noteId && glyphEdit?.pitchIndex === g.pitchIndex && glyphEdit?.kind === g.kind
            const note = notes.find(n => n.id === g.noteId)
            const hovered = note != null && hoverMeasure === note.measureIndex
            if (!editing && !hovered) return null
            const cx = editing ? glyphEdit!.curX : g.x
            const cy = editing ? glyphEdit!.curY : g.y
            return (
              <div
                key={g.noteId + g.kind + g.pitchIndex}
                className="absolute rounded-full"
                style={{
                  left: cx - GLYPH_HANDLE_R / 2,
                  top: cy - GLYPH_HANDLE_R / 2,
                  width: GLYPH_HANDLE_R,
                  height: GLYPH_HANDLE_R,
                  background: editing ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.45)',
                  border: '1.5px solid white',
                  boxShadow: '0 0 6px rgba(139,92,246,0.5)',
                  cursor: 'grab',
                  zIndex: 28,
                }}
              />
            )
          }),
        )}

        {/* Delete brush trail */}
        {isDeleteMode && trail.length > 0 && (
          <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 30, overflow: 'visible' }}>
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
        {isInsertMode && (insertSession ?? insertHover) && (() => {
          const s = (insertSession ?? insertHover)!
          const topY = s.stave === 'treble' ? TREBLE_TOP_Y : BASS_TOP_Y
          return (
            <div
              className="absolute pointer-events-none select-none font-bold leading-none"
              style={{
                left: s.anchorX - 7,
                top: topY - 20,
                color: insertSession ? 'rgba(139,92,246,1)' : 'rgba(139,92,246,0.6)',
                fontSize: 18,
                zIndex: 22,
              }}
            >
              ⌄
            </div>
          )
        })()}
      </div>
    </div>

      {/* Scratch staff for the locked insertion point. Lives outside the
          horizontally-scrolling card so it can flow up into the page instead of
          being clipped by the card's top edge; it tracks horizontal scroll via scrollLeft. */}
      {isInsertMode && insertSession && (() => {
        const part = insertSession.stave === 'treble' ? treblePart : bassPart
        const measure = part.measures[insertSession.measureIndex]
        if (!measure) return null
        const topY = insertSession.stave === 'treble' ? TREBLE_TOP_Y : BASS_TOP_Y
        return (
          <InsertStaff
            left={CARD_PAD - 4 + insertSession.anchorX - scrollLeft}
            top={CARD_PAD + topY - 96 - 16}
            capacity={measureRemainingBeats(measure, timeSig)}
            timeSig={timeSig}
            keySig={keySig}
            clef={insertSession.stave === 'treble' ? 'treble' : 'bass'}
            selectedDuration={selectedDuration}
            selectedAccidental={selectedAccidental}
            isDotted={isDotted}
            isRest={isRest}
            onCommit={commitInsert}
            onCancel={() => { setInsertSession(null); onInsertComplete?.() }}
          />
        )
      })()}
    </div>
  )
}
