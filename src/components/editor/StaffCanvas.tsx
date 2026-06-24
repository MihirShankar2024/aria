import { useEffect, useMemo, useRef, useState } from 'react'
import { renderStaff, type StaffLayout, type NoteGeometry } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, noteHasPitchAtStaffY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, measureCapacity, isMeasureFull, noteCanFit, measureRemainingBeats, noteBeatDuration, incompleteVoices, effectiveTimeSigAt } from '../../lib/beats'
import type { TupletSpec } from './PolyrhythmPicker'
import { getClipboard, cloneWithFreshIds } from './clipboard'
import { buildTie } from '../../lib/ties'
import { InsertStaff } from './InsertStaff'
import type { ScrollSync } from '../../hooks/useScrollSync'
import type { PlaybackLayout } from '../../hooks/usePlaybackScroll'
import { slurHandlePoints, slurArcPath, hitSlurHandle, slurEditPatch, SLUR_HANDLE_R, type SlurEdit } from './slurEditing'
import { hitGlyphHandle, GLYPH_HANDLE_R, type GlyphEdit } from './accidentalEditing'
import { useDeleteTrail, TRAIL_MS, type PendingRest } from './useDeleteTrail'
import { renderGhostNote, type GhostRender } from './ghostNote'
import { normalizeMeasureRests } from '../../lib/rests'
import { diatonicStep, writtenPitchToConcert, concertPitchToWritten, transposeMeasuresForDisplay, transposeKeySigForDisplay } from '../../lib/transposition/transpose'
import { selKey, selectionByEvent, isPitchSelected, moveSelectedPitches } from './noteSelection'
import type { Measure, TimeSig, KeySig, Duration, Accidental, ArticulationType, NoteArticulation, Tie, Clef, Note, NoteEvent, VoiceNumber, Pitch, Annotation } from '../../types/score'
import type { ScoreAction } from '../../state/actions'
import { AnnotationsLayer } from './AnnotationsLayer'
import { annotationBounds, rectHit } from '../../lib/annotations/geometry'
import { buildAnnotation } from './annotationSpawn'
import type { CatalogEntry } from '../../lib/annotations/catalog'

const EMPTY_ANNOTATIONS: Annotation[] = []

const STAVE_Y = 48
const DOT_R = 7
const CHORD_PROXIMITY_X = 20  // px — max chord-stacking radius for long notes
// A flagged note's reported notehead center (cx) sits a hair right of the drawn
// notehead because notePx includes the flag, so a ghost/cursor snapped onto an
// 8th/16th lands too far right. Nudge it back left to re-center over the head.
const FLAGGED_TARGET_X_OFFSET = -5
// Accidental columns can project far left; count only part of that width for chord
// targeting so the stack zone doesn't become too sticky.
const ACCIDENTAL_ZONE_WEIGHT = 0.75
// The chord-stacking radius scales down for shorter durations: densely packed
// sixteenths sit close together, so a fixed 20px zone would cover the whole bar and
// leave no room to register a fresh-note placement. Subtle, threshold-based scaling.
function chordProximityForBeats(beats: number): number {
  if (beats <= 0.25) return 7   // sixteenth
  if (beats <= 0.5) return 9    // eighth
  if (beats < 1) return 12      // dotted eighth (0.75)
  if (beats <= 1) return 15     // quarter
  if (beats < 2) return 17      // dotted quarter (1.5)
  return CHORD_PROXIMITY_X      // half and longer
}
// End-slot ghost preview: how far the next note would sit past the last one.
const FALLBACK_PER_BEAT = 30  // px per quarter-beat when a measure has only one note to measure from
const PREVIEW_MIN_GAP = 18    // px — keep the preview clear of the last notehead
const BRUSH_R = 15            // px radius of the delete brush
const NOTEHEAD_HIT_R = 12     // px — precise click radius on a notehead (apply dot/accidental)
const NOTEHEAD_HIT_Y_TOL = 4  // px — keep half-step-above clicks from being mistaken as same head
const PLACE_DRAG_TOLERANCE_PX = 4  // px — press-and-release within this counts as a tap (places a note)

const STAVE_TOP_Y    = STAVE_Y + STAVE_TOP_OFFSET
const STAVE_BOTTOM_Y = STAVE_TOP_Y + 4 * LINE_SPACING
const CARD_PAD_X = 16  // px — the card's px-4 horizontal padding
const CARD_PAD_Y = 32  // px — the card's py-8 vertical padding

// Broom highlight box vertical offsets — tune these to align each rect with the actual glyph.
const BROOM_KEY_SIG_DY  = 30  // key signature accidentals
const BROOM_TIME_SIG_DY = 48  // time signature digits
const BROOM_TEMPO_DY    = 8   // tempo marking text above the stave
const PANEL_EDGE_DEADBAND_PX = 10  // keep cursor from latching at panel extremes

interface StaffCanvasProps {
  partId: string
  instrument: string
  measures: Measure[]
  timeSig: TimeSig
  keySig: KeySig
  clef?: Clef
  /** When true, render in the part's written/transposed key and treat clicks as
   * written pitches (converted back to concert on entry). Concert pitch otherwise. */
  transposedView?: boolean
  dispatch: (action: ScoreAction) => void
  selectedDuration: Duration
  selectedAccidental: Accidental
  selectedArticulation: ArticulationType | null
  isDotted: boolean
  isRest: boolean
  activeVoice?: VoiceNumber
  ties: Tie[]
  isTieMode: boolean
  isFillMode: boolean
  isDeleteMode: boolean
  isBroomMode: boolean
  isInsertMode: boolean
  isSharpshooterMode?: boolean
  /** When true, placed notes flow into a reserved tuplet of `tupletSpec` (polyrhythm entry). */
  tupletEntry?: boolean
  tupletSpec?: TupletSpec
  /** Free-floating expressive marks for this part + the armed Annotations tool state. */
  annotations?: Annotation[]
  annotationEntry?: boolean
  selectedAnnotation?: CatalogEntry | null
  editingAnnotationId?: string | null
  onAnnotationSpawned?: (id: string | null) => void
  /** When true (default), placing a note in keyboard mode advances the cursor to the next
   * beat; when false, the cursor stays on the note just placed. */
  advanceOnPlace?: boolean
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
  onPlaceFailed?: () => void
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
  fromPitchId: string
  fromX: number
  fromY: number
  curX: number
  curY: number
  // The notehead the dragging end is locked onto (always the nearest head), so the
  // preview shows the slur snapped exactly where it will land.
  lockId: string | null
  lockPitchId: string | null
  lockX: number
  lockY: number
}

// An auxiliary glyph (accidental/dot) or tie swept by the broom, removed on release.
type BroomTarget =
  | { kind: 'glyph'; key: string; noteId: string; pitchIndex: number; glyphKind: 'accidental' | 'dot' | 'articulation'; artType?: ArticulationType; x: number; y: number }
  | { kind: 'tie'; key: string; tieId: string; x: number; y: number }
  | { kind: 'keySig'; key: string; measureIndex: number; measureNumber: number; x: number; y: number }
  | { kind: 'timeSig'; key: string; measureIndex: number; measureNumber: number; x: number; y: number }
  | { kind: 'tempo'; key: string; measureNumber: number; x: number; y: number }
  | { kind: 'annotation'; key: string; annotationId: string; x: number; y: number; w: number; h: number }

export function StaffCanvas({
  partId,
  instrument,
  measures,
  timeSig,
  keySig,
  clef = 'treble',
  transposedView = false,
  dispatch,
  selectedDuration,
  selectedAccidental,
  selectedArticulation,
  isDotted,
  isRest,
  activeVoice = 1,
  ties,
  isTieMode,
  isFillMode,
  isDeleteMode,
  isBroomMode,
  isInsertMode,
  isSharpshooterMode = false,
  tupletEntry = false,
  tupletSpec = { played: 3, inSpaceOf: 2, baseDuration: 'eighth' },
  annotations = EMPTY_ANNOTATIONS,
  annotationEntry = false,
  selectedAnnotation = null,
  editingAnnotationId = null,
  onAnnotationSpawned,
  advanceOnPlace = true,
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
  onPlaceFailed,
  onPlaybackLayoutChange,
}: StaffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [layout, setLayout] = useState<StaffLayout | null>(null)
  // Grey "held note/rest" glyph that rides the cursor in placement mode. Rendered
  // once with the real engine whenever the selected note params change, then moved
  // under the cursor via SVG translate (no per-frame re-render).
  const [ghost, setGhost] = useState<GhostRender | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const isSelectingRef = useRef(false)
  // Drag-move of selected noteheads: started on a notehead in select mode. `keys` are
  // the composite selection keys being moved; `hitKey` is the grabbed head. deltaSteps
  // is the snapped vertical staff-position offset (down = positive) since the press.
  const [moveDrag, setMoveDrag] = useState<{ keys: string[]; hitKey: string; startY: number; deltaSteps: number } | null>(null)
  const [tieDrag, setTieDrag] = useState<TieDrag | null>(null)
  const [slurEdit, setSlurEdit] = useState<SlurEdit | null>(null)
  const [glyphEdit, setGlyphEdit] = useState<GlyphEdit | null>(null)
  const [hoverMeasure, setHoverMeasure] = useState<number | null>(null)
  // Set when a glyph-handle drag is committed on mouseup, so the trailing click doesn't
  // also place a note.
  const suppressClickRef = useRef(false)
  // Mousedown coords in default note-entry mode. Placement fires on mouseup (drag-tolerant)
  // rather than the native click, which a browser swallows when a trackpad press drifts.
  const placeDownRef = useRef<{ x: number; y: number } | null>(null)
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set())
  const [insertHover, setInsertHover] = useState<InsertSession | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  // Measure index briefly flashed red when a paste is rejected for overflowing the bar.
  const [failMeasure, setFailMeasure] = useState<number | null>(null)
  const failTimerRef = useRef<number | null>(null)

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
  // Set by placeAt: true when the last placement appended a brand-new note/rest (vs.
  // chord-add, rest-replace, or modifier-on-existing). Lets the keyboard flow advance
  // to the next open spot after appending, while staying put when editing an existing note.
  const placementAppendedRef = useRef(false)
  // Read inside the once-bound keydown handler, so toggling it takes effect live.
  const advanceOnPlaceRef = useRef(advanceOnPlace)
  advanceOnPlaceRef.current = advanceOnPlace
  // The keydown handler is registered once (deps []), so it must read live measure
  // data through refs rather than its stale capture.
  const measuresRef = useRef(measures)
  measuresRef.current = measures
  const timeSigRef = useRef(timeSig)
  timeSigRef.current = timeSig
  const mouseInStaffRef = useRef(false)
  const isSelectModeRef = useRef(isSelectMode)
  isSelectModeRef.current = isSelectMode
  // Default note-entry mode: no special tool active. Placement is driven by mousedown→mouseup.
  const isPlaceMode = !isSelectMode && !isDeleteMode && !isBroomMode && !isTieMode
    && !isSharpshooterMode && !isFillMode && !isInsertMode
  const { trail, push: pushTrail } = useDeleteTrail(isDeleteMode)
  const { trail: broomTrail, push: pushBroom } = useDeleteTrail(isBroomMode)
  // Broom: auxiliary glyphs (accidentals/dots) and ties swept under the brush, removed
  // on release. Ref is the synchronous source of truth; state mirrors it for rendering.
  const broomRef = useRef<Map<string, BroomTarget>>(new Map())
  const [broomMarks, setBroomMarks] = useState<BroomTarget[]>([])
  const broomingRef = useRef(false)

  // What we draw: in transposed view, the part's written key + transposed notes
  // (ids preserved so ties/selection still match the concert-pitch store).
  const displayMeasures = useMemo(
    () => (transposedView ? transposeMeasuresForDisplay(measures, instrument) : measures),
    [transposedView, measures, instrument],
  )
  const displayKeySig = useMemo(
    () => (transposedView ? transposeKeySigForDisplay(keySig, instrument) : keySig),
    [transposedView, keySig, instrument],
  )

  // A staff click resolves to a *written* pitch in transposed view; convert back to
  // concert before it is stored or compared against the concert-pitch store.
  const toConcert = (pitch: Pitch): Pitch =>
    transposedView ? writtenPitchToConcert(pitch, instrument) : pitch
  // Stored concert pitches spelled for hit-testing against the written display.
  const toWritten = (pitches: Pitch[]): Pitch[] =>
    transposedView ? pitches.map(p => concertPitchToWritten(p, instrument)) : pitches

  useEffect(() => {
    if (!containerRef.current) return
    try {
      const result = renderStaff({
        container: containerRef.current,
        measures: displayMeasures,
        timeSig,
        keySig: displayKeySig,
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
  }, [displayMeasures, timeSig, displayKeySig, clef, ties, initialTempo, tempoChanges, forcedStaveWidths])

  useEffect(() => {
    if (!layout || !onPlaybackLayoutChange) return
    onPlaybackLayoutChange({ measures: layout.measures, notes: layout.notes })
  }, [layout, onPlaybackLayoutChange])

  // Re-render the grey cursor ghost only when the selected note params change.
  // Suppressed in every non-placement mode (no held note to preview there).
  useEffect(() => {
    if (isTieMode || isDeleteMode || isBroomMode || isInsertMode || isSelectMode || isFillMode || isSharpshooterMode || annotationEntry) {
      setGhost(null)
      return
    }
    const nextGhost = renderGhostNote({
      duration: selectedDuration,
      dotted: isDotted,
      accidental: selectedAccidental,
      isRest,
      clef,
      timeSig,
      keySig,
      voice: activeVoice,
    })
    setGhost(nextGhost)
  }, [selectedDuration, isDotted, selectedAccidental, isRest, clef, timeSig, keySig, activeVoice,
      isTieMode, isDeleteMode, isBroomMode, isInsertMode, isSelectMode, isFillMode, isSharpshooterMode, annotationEntry])

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
      // If placing the last note just filled this bar, there's nothing more to add
      // here — advance to the start of the next measure (if one exists) so the cursor
      // doesn't linger in the now-dead end slot.
      const measureHere = measures[kc.measureIndex]
      const nextG = layout.measures[kc.measureIndex + 1]
      if (measureHere && nextG && isMeasureFull(measureHere, effectiveTimeSigAt(measures, kc.measureIndex, timeSig))) {
        const nextNotes = layout.notes
          .filter(n => n.measureIndex === kc.measureIndex + 1)
          .sort((a, b) => a.cx - b.cx)
        const first = nextNotes[0]
        setKeyboardCursor({
          ...kc,
          x: first ? first.cx : nextG.x + 16,
          measureIndex: kc.measureIndex + 1,
          anchorId: first?.id,
          atEnd: false,
        })
        return
      }
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

  // Leaving broom mode abandons any in-progress sweep.
  useEffect(() => {
    if (!isBroomMode) { broomingRef.current = false; broomRef.current = new Map(); setBroomMarks([]) }
  }, [isBroomMode])

  // Leaving insert mode abandons any in-progress insertion.
  useEffect(() => {
    if (!isInsertMode) { setInsertSession(null); setInsertHover(null) }
  }, [isInsertMode])

  // Leaving tie mode abandons any in-progress slur drag or handle edit.
  useEffect(() => {
    if (!isTieMode) setTieDrag(null)
  }, [isTieMode])

  // Entering select mode drops the edit cursor so it doesn't stay frozen on the staff.
  useEffect(() => {
    if (isSelectMode) { setHoverInfo(null); setKeyboardCursor(null) }
  }, [isSelectMode])

  // Leaving sharpshooter mode abandons any in-progress handle drags.
  useEffect(() => {
    if (!isSharpshooterMode) { setGlyphEdit(null); setSlurEdit(null); return }
    setHoverInfo(null)
    setKeyboardCursor(null)
  }, [isSharpshooterMode])

  // measureId for a note id (for committing a glyph offset).
  const measureIdForNote = (noteId: string): string | null =>
    measures.find(m => m.notes.some(n => n.id === noteId))?.id ?? null

  // Arrow-key cursor: works whenever the mouse is inside this staff (no click needed).
  // Mouse movement resets the keyboard adjustment — the two coexist, last one wins.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only active when the mouse is inside this staff canvas.
      if (!mouseInStaffRef.current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Paste at the cursor. No-ops without a cursor (e.g. select mode clears it), so the
      // user exits to note-entry mode and positions the cursor before pasting.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteRef.current()
        return
      }
      // Select mode owns the arrow keys (nudge selected notes) — handled in ScoreEditor.
      if (isSelectModeRef.current) return
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
          // No further note in this measure. If the bar still has room, park on the
          // end slot (to add the next note); a second press then crosses into the next
          // measure. If the bar is full, there's nothing to add here — skip straight to
          // the next measure. Gate purely on capacity, not pixel position, so the slot
          // is reliable even when the last note renders near the bar's edge.
          const measureHere = measuresRef.current[mIdx]
          const full = measureHere ? isMeasureFull(measureHere, effectiveTimeSigAt(measuresRef.current, mIdx, timeSigRef.current)) : false
          const endSlotX = g ? g.x + g.width - 16 : baseCursor.x
          if (!full && !baseCursor.atEnd) {
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
          const placedId = placeAtRef.current(baseCursor.x, snapY, baseCursor.atEnd === true)
          if (placedId) {
            // Free mouse hover (not locked into a keyboard slot): just add the note and
            // leave the cursor where it was — no teleport to the end slot or placed note.
            const locked = keyboardCursorRef.current !== null
            if (!locked) {
              // do nothing — the hovering cursor stays put
            } else if (placementAppendedRef.current) {
              // Appended a new note. With auto-advance on (default), hover the next open
              // spot of that measure (the end slot previews where the next note goes); if
              // this filled the bar, the reflow effect auto-advances to the next measure.
              // With it off, stay anchored on the note just placed.
              if (advanceOnPlaceRef.current) {
                setKeyboardCursor({ ...baseCursor, anchorId: undefined, atEnd: true })
              } else {
                setKeyboardCursor({ ...baseCursor, anchorId: placedId, atEnd: false })
              }
            } else if (!baseCursor.atEnd) {
              // Edited an existing note (chord-add / rest-replace / modifier): stay on it.
              setKeyboardCursor({ ...baseCursor, anchorId: placedId, atEnd: false })
            }
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

  // Per-note chord radius lookup: shorter durations get a tighter zone.
  const noteBeatsById = new Map<string, number>()
  for (const meas of measures) for (const ev of meas.notes) noteBeatsById.set(ev.id, noteBeatDuration(ev))
  const chordProximityFor = (id: string) => chordProximityForBeats(noteBeatsById.get(id) ?? 1)

  // Find the nearest note (not rest) whose chord zone covers x. A finite maxDist is a
  // chord-stacking query, so each note's zone is capped by its duration-scaled radius;
  // an infinite maxDist (tie/delete targeting) keeps the plain nearest-note behaviour.
  const nearestNoteAtX = (x: number, maxDist = Infinity, voice?: VoiceNumber): NoteGeometry | null => {
    if (!layout) return null
    const scaled = Number.isFinite(maxDist)
    let best: NoteGeometry | null = null
    let bestDist = Infinity
    let bestCenterDist = Infinity
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      if (voice !== undefined && n.voice !== voice) continue
      const weightedLeftX = n.x - (n.x - n.leftX) * ACCIDENTAL_ZONE_WEIGHT
      // Distance to the note's horizontal span (incl. accidentals), 0 when inside it,
      // so the chord-target zone covers the accidentals to the left of the notehead.
      const d = x < weightedLeftX ? weightedLeftX - x : x > n.rightX ? x - n.rightX : 0
      const centerDist = Math.abs(n.cx - x)
      const limit = scaled ? Math.min(maxDist, chordProximityFor(n.id)) : maxDist
      if (d >= limit) continue
      if (d < bestDist || (d === bestDist && centerDist < bestCenterDist)) {
        bestDist = d
        bestCenterDist = centerDist
        best = n
      }
    }
    return best
  }

  // Find the nearest rest within CHORD_PROXIMITY_X of an x position (for replace-on-rest).
  const nearestRestAtX = (x: number, maxDist = CHORD_PROXIMITY_X, voice?: VoiceNumber): NoteGeometry | null => {
    if (!layout) return null
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of layout.notes) {
      if (n.type !== 'rest') continue
      if (voice !== undefined && n.voice !== voice) continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  // Leftward nudge to re-center a snapped ghost/cursor when the target note under it
  // is flagged (8th/16th), whose reported center sits a hair right of the drawn head.
  const flaggedTargetOffset = (target: NoteGeometry | null) => {
    if (!target) return 0
    const ev = measures[target.measureIndex]?.notes.find(n => n.id === target.id)
    return ev?.type === 'note' && (ev.duration === 'eighth' || ev.duration === 'sixteenth')
      ? FLAGGED_TARGET_X_OFFSET
      : 0
  }

  // Find the note whose notehead sits directly under (x, y) — a precise hit on the
  // glyph, not just the same column (used by the dot/accidental click-to-apply path).
  const noteHeadAt = (x: number, y: number): { note: NoteGeometry; pitchIndex: number } | null => {
    if (!layout) return null
    const r2 = NOTEHEAD_HIT_R * NOTEHEAD_HIT_R
    let best: { note: NoteGeometry; pitchIndex: number } | null = null
    let bestDist = r2
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      n.ys.forEach((ny, i) => {
        if (Math.abs(ny - y) > NOTEHEAD_HIT_Y_TOL) return
        const hx = n.xs[i] ?? n.x
        const d = (hx - x) * (hx - x) + (ny - y) * (ny - y)
        if (d <= bestDist) { bestDist = d; best = { note: n, pitchIndex: i } }
      })
    }
    return best
  }

  // Forgiving notehead pick for tie endpoints: snap to the nearest note column (by x),
  // then the head in that column whose y is closest to the cursor. Returns the head's
  // event id, stable Pitch.id, and drawn position. Unlike noteHeadAt this doesn't require
  // a precise glyph hit, so a tie still lands when the cursor is roughly over the head.
  const nearestHeadAt = (x: number, y: number): { noteId: string; pitchId: string; x: number; y: number } | null => {
    const note = nearestNoteAtX(x)
    if (!note || note.type !== 'note' || note.ys.length === 0) return null
    let bi = 0, bd = Infinity
    note.ys.forEach((ny, i) => { const d = Math.abs(ny - y); if (d < bd) { bd = d; bi = i } })
    const ev = measures[note.measureIndex]?.notes.find(n => n.id === note.id)
    if (!ev || ev.type !== 'note') return null
    const pitch = ev.pitches[bi]
    if (!pitch) return null
    return { noteId: note.id, pitchId: pitch.id, x: note.xs[bi] ?? note.x, y: note.ys[bi] ?? note.y }
  }

  // The sticky articulation as a fresh single-mark list for a new event (undefined when none).
  const selArt = (): NoteArticulation[] | undefined =>
    selectedArticulation ? [{ type: selectedArticulation }] : undefined

  // Toggle the sticky articulation in an event's set (stacking: add if absent, remove if present).
  const toggledArticulations = (cur: NoteArticulation[] | undefined): NoteArticulation[] => {
    const list = cur ?? []
    return list.some(a => a.type === selectedArticulation)
      ? list.filter(a => a.type !== selectedArticulation)
      : [...list, { type: selectedArticulation! }]
  }

  // Apply the active modifier tool(s) — dot, accidental, and/or articulation — to an existing
  // note. The accidental lands on the chord tone at the clicked staff position; the articulation
  // toggles on the whole event. onNotePlaced clears dot/accidental (articulation is sticky).
  const applyModifierToExistingNote = (target: NoteGeometry, clickY: number, pitchIndex?: number) => {
    const measure = measures[target.measureIndex]
    if (!measure) return
    const ev = measure.notes.find(n => n.id === target.id)
    if (!ev || ev.type !== 'note') return
    const patch: Partial<Note> = {}
    if (isDotted) patch.dots = 1
    if (selectedArticulation !== null) patch.articulations = toggledArticulations(ev.articulations)
    if (selectedAccidental !== null) {
      if (pitchIndex !== undefined && ev.pitches[pitchIndex]) {
        patch.pitches = ev.pitches.map((p, i) =>
          i === pitchIndex ? { ...p, accidental: selectedAccidental } : p,
        )
      } else {
        const clicked = toConcert(staffYToPitch(clickY, STAVE_Y, clef))
        patch.pitches = ev.pitches.map(p =>
          p.step === clicked.step && p.octave === clicked.octave
            ? { ...p, accidental: selectedAccidental }
            : p,
        )
      }
    }
    if (patch.pitches && patch.pitches.every((p, i) =>
      p.step === ev.pitches[i].step && p.octave === ev.pitches[i].octave && p.accidental === ev.pitches[i].accidental,
    )) {
      delete patch.pitches
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

  // Broom: mark only the auxiliary glyphs/ties actually under the brush at (x, y).
  const broomAt = (x: number, y: number) => {
    if (!layout) return
    let added = false
    for (const g of layout.glyphs) {
      if (Math.hypot(g.x - x, g.y - y) > BRUSH_R) continue
      const key = `g:${g.noteId}:${g.pitchIndex}:${g.kind}:${g.artType ?? ''}`
      if (broomRef.current.has(key)) continue
      broomRef.current.set(key, { kind: 'glyph', key, noteId: g.noteId, pitchIndex: g.pitchIndex, glyphKind: g.kind, artType: g.artType, x: g.x, y: g.y })
      added = true
    }
    for (const geo of layout.ties) {
      const pts = slurHandlePoints(geo)
      const near = (['start', 'end', 'apex'] as const).some(h => Math.hypot(pts[h].x - x, pts[h].y - y) <= BRUSH_R)
      if (!near) continue
      const key = `t:${geo.id}`
      if (broomRef.current.has(key)) continue
      broomRef.current.set(key, { kind: 'tie', key, tieId: geo.id, x: pts.apex.x, y: pts.apex.y })
      added = true
    }
    for (const d of layout.decorations) {
      if (Math.hypot(d.x - x, d.y - y) > BRUSH_R * 2) continue
      const key = `d:${d.kind}:${d.measureIndex}`
      if (broomRef.current.has(key)) continue
      const measureNumber = measures[d.measureIndex]?.number
      if (measureNumber === undefined) continue
      broomRef.current.set(key, { kind: d.kind as 'keySig' | 'timeSig', key, measureIndex: d.measureIndex, measureNumber, x: d.x, y: d.y })
      added = true
    }
    for (const tm of layout.tempoMarks) {
      if (tm.measureNumber === 1) continue // first measure's tempo is global, not removable
      // Tempo text renders above the stave; adjust hit point up to match the visual.
      const tmBroomX = tm.x + 28
      const tmBroomY = tm.y - 16
      if (Math.hypot(tmBroomX - x, tmBroomY - y) > BRUSH_R * 2) continue
      const key = `tempo:${tm.measureNumber}`
      if (broomRef.current.has(key)) continue
      broomRef.current.set(key, { kind: 'tempo', key, measureNumber: tm.measureNumber, x: tmBroomX, y: tmBroomY })
      added = true
    }
    // Annotations (dynamics / ornaments / symbols / text). Register when the brush touches
    // anywhere within the mark's full bounding box, and highlight that whole area.
    for (const ann of annotations) {
      const idx = measures.findIndex(m => m.id === ann.anchor.measureId)
      const g = idx >= 0 ? layout.measures[idx] : undefined
      if (!g) continue
      const r = annotationBounds(ann, g.x, STAVE_Y)
      if (!rectHit(r, x, y, BRUSH_R)) continue
      const key = `a:${ann.id}`
      if (broomRef.current.has(key)) continue
      broomRef.current.set(key, { kind: 'annotation', key, annotationId: ann.id, x: r.x, y: r.y, w: r.w, h: r.h })
      added = true
    }
    if (added) setBroomMarks([...broomRef.current.values()])
  }

  // On release, remove every swept glyph (accidental → null / dot → 0) and tie.
  const commitBroom = () => {
    broomingRef.current = false
    const targets = [...broomRef.current.values()]
    broomRef.current = new Map()
    setBroomMarks([])
    if (targets.length === 0) return
    // Group glyph removals per note so one note's accidental + dot collapse into a
    // single patch built off its current pitches/dots.
    const glyphsByNote = new Map<string, Extract<BroomTarget, { kind: 'glyph' }>[]>()
    for (const t of targets) {
      if (t.kind !== 'glyph') continue
      const arr = glyphsByNote.get(t.noteId) ?? []
      arr.push(t); glyphsByNote.set(t.noteId, arr)
    }
    for (const [noteId, gs] of glyphsByNote) {
      const measureId = measureIdForNote(noteId)
      if (!measureId) continue
      const note = measures.flatMap(m => m.notes).find(n => n.id === noteId)
      if (!note) continue
      const patch: Partial<Note> = {}
      // Articulations live on the event (note or rest); strip the swept types.
      const artTypes = new Set(gs.filter(g => g.glyphKind === 'articulation').map(g => g.artType))
      if (artTypes.size > 0 && note.articulations) patch.articulations = note.articulations.filter(a => !artTypes.has(a.type))
      if (note.type === 'note') {
        if (gs.some(g => g.glyphKind === 'dot')) patch.dots = 0
        const accIdx = new Set(gs.filter(g => g.glyphKind === 'accidental').map(g => g.pitchIndex))
        if (accIdx.size > 0) {
          patch.pitches = note.pitches.map((p, i) => accIdx.has(i) ? { ...p, accidental: null, accidentalOffset: undefined } : p)
        }
      }
      if (Object.keys(patch).length) dispatch({ type: 'UPDATE_NOTE', partId, measureId, noteId, patch })
    }
    for (const t of targets) {
      if (t.kind === 'tie') dispatch({ type: 'REMOVE_TIE', partId, tieId: t.tieId })
      if (t.kind === 'keySig') {
        if (t.measureNumber === 1) {
          dispatch({ type: 'SET_GLOBAL_KEY_SIG', keySig: { fifths: 0, mode: 'major' } })
        } else {
          dispatch({ type: 'CLEAR_MEASURE_KEY_SIG', measureNumber: t.measureNumber })
        }
      }
      if (t.kind === 'timeSig') dispatch({ type: 'CLEAR_MEASURE_TIME_SIG', measureNumber: t.measureNumber })
      if (t.kind === 'tempo') dispatch({ type: 'REMOVE_MEASURE_TEMPO', measureNumber: t.measureNumber })
      if (t.kind === 'annotation') dispatch({ type: 'DELETE_ANNOTATION', partId, id: t.annotationId })
    }
  }

  // On release, remove the marked notes entirely and shift the remainder left
  // (no in-place rests), the same clean-delete path used by select + Delete.
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
    const removedIds: string[] = []
    for (const [mIdx, ids] of byMeasure) {
      const measure = measures[mIdx]
      if (!measure) continue
      for (const id of ids) if (measure.notes.find(n => n.id === id)?.type === 'note') removedIds.push(id)
      const notes = normalizeMeasureRests(measure.notes.filter(n => !ids.has(n.id)), effectiveTimeSigAt(measures, mIdx, timeSig))
      edits.push({ partId, measureId: measure.id, notes })
    }
    if (edits.length === 0) return
    dispatch({ type: 'APPLY_MEASURE_NOTES', edits, removedIds })
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
      if (n.type === 'rest') {
        if (n.x >= minX && n.x <= maxX && n.ys.some(y => y >= minY && y <= maxY)) ids.add(n.id)
        continue
      }
      // Per notehead: select only the heads whose x/y fall inside the box.
      n.ys.forEach((y, i) => {
        const hx = n.xs[i] ?? n.x
        if (hx >= minX && hx <= maxX && y >= minY && y <= maxY) ids.add(selKey(n.id, i))
      })
    }
    onSelectionChange?.(ids)
  }

  // Snapped vertical staff-position delta (each line/space = one step), down = positive.
  const snapDeltaSteps = (y: number, startY: number) =>
    Math.round((y - startY) / (LINE_SPACING / 2))

  // Commit a drag-move: shift every selected notehead diatonically by the snapped delta
  // (dragging down lowers pitch) in a single undo-able edit. Selection is preserved.
  const commitMove = (drag: { keys: string[]; deltaSteps: number }) => {
    if (drag.deltaSteps === 0) return
    const byEvent = selectionByEvent(new Set(drag.keys))
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    const newKeys: string[] = []
    for (const measure of measures) {
      if (!measure.notes.some(n => byEvent.has(n.id))) continue
      const res = moveSelectedPitches(measure.notes, byEvent, p => diatonicStep(p, -drag.deltaSteps))
      edits.push({ partId, measureId: measure.id, notes: res.notes })
      newKeys.push(...res.newKeys)
    }
    if (edits.length) {
      dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
      onSelectionChange?.(new Set(newKeys))  // re-key: heads kept selected at sorted indices
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSelectMode) {
      const coords = getCoords(e)
      if (!coords) return
      setHoverMeasure(getMeasureIndexAtX(coords.x))
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
    if (isBroomMode) {
      const coords = getCoords(e)
      if (!coords) return
      pushBroom(coords.x, coords.y, broomingRef.current)
      if (broomingRef.current) broomAt(coords.x, coords.y)
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
      if (tieDrag) {
        // Always lock the dragging end onto the nearest notehead (excluding the source
        // head), so the grey preview snaps exactly where the slur will be created.
        const target = nearestHeadAt(coords.x, coords.y)
        const sameHead = target && target.noteId === tieDrag.fromId && target.pitchId === tieDrag.fromPitchId
        const locked = target && !sameHead ? target : null
        setTieDrag({
          ...tieDrag,
          curX: coords.x,
          curY: coords.y,
          lockId: locked ? locked.noteId : null,
          lockPitchId: locked ? locked.pitchId : null,
          lockX: locked ? locked.x : coords.x,
          lockY: locked ? locked.y : coords.y,
        })
      }
      return
    }
    if (isInsertMode) {
      if (insertSession) return  // gap locked — building in the scratch staff
      const coords = getCoords(e)
      setInsertHover(coords ? gapAtX(getMeasureIndexAtX(coords.x), coords.x) : null)
      return
    }
    if (isSharpshooterMode) {
      const coords = getCoords(e)
      setHoverMeasure(coords ? getMeasureIndexAtX(coords.x) : null)
      if (glyphEdit && coords) { setGlyphEdit({ ...glyphEdit, curX: coords.x, curY: coords.y }); return }
      if (slurEdit && coords) { setSlurEdit({ ...slurEdit, curX: coords.x, curY: coords.y }); return }
      return
    }
    const coords = getCoords(e)
    if (!coords) return
    const panelHeight = containerRef.current?.clientHeight ?? e.currentTarget.clientHeight
    if (coords.y <= PANEL_EDGE_DEADBAND_PX || coords.y >= panelHeight - PANEL_EDGE_DEADBAND_PX) {
      setHoverInfo(null)
      setKeyboardCursor(null)
      return
    }
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
      // Pressing on a notehead selects/drag-moves it; pressing empty staff rubber-bands.
      const hit = noteHeadAt(coords.x, coords.y)
      if (hit) {
        const hitKey = selKey(hit.note.id, hit.pitchIndex)
        // Drag the whole current selection if this head is already in it, else grab just it.
        const keys = selectedNoteIds?.has(hitKey) ? [...selectedNoteIds] : [hitKey]
        if (!selectedNoteIds?.has(hitKey)) onSelectionChange?.(new Set([hitKey]))
        setMoveDrag({ keys, hitKey, startY: coords.y, deltaSteps: 0 })
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
    if (isBroomMode) {
      broomingRef.current = true
      pushBroom(coords.x, coords.y, true)
      broomAt(coords.x, coords.y)
      return
    }
    if (isSharpshooterMode) {
      const slurHit = layout ? hitSlurHandle(layout.ties, coords.x, coords.y) : null
      if (slurHit) {
        setSlurEdit({ partId, ...slurHit, downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y })
        return
      }
      const g = layout ? hitGlyphHandle(layout.glyphs, coords.x, coords.y) : null
      const measureId = g ? measureIdForNote(g.noteId) : null
      if (g && measureId) {
        setGlyphEdit({
          partId, measureId, noteId: g.noteId, pitchIndex: g.pitchIndex, kind: g.kind, artType: g.artType,
          downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y,
        })
        return
      }
    }
    if (isPlaceMode) { placeDownRef.current = coords; return }
    if (!isTieMode) return
    const head = nearestHeadAt(coords.x, coords.y)
    if (!head) return
    setTieDrag({
      fromId: head.noteId, fromPitchId: head.pitchId, fromX: head.x, fromY: head.y,
      curX: coords.x, curY: coords.y, lockId: null, lockPitchId: null, lockX: coords.x, lockY: coords.y,
    })
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
      const note = layout?.notes.find(n => n.id === glyphEdit.noteId)
      const moved = coords.x !== glyphEdit.downX || coords.y !== glyphEdit.downY
      setGlyphEdit(null)
      suppressClickRef.current = true
      if (note && moved) {
        if (glyphEdit.kind === 'articulation' && glyphEdit.artType) {
          dispatch({
            type: 'UPDATE_ARTICULATION_OFFSET', partId: glyphEdit.partId, measureId: glyphEdit.measureId,
            noteId: glyphEdit.noteId, artType: glyphEdit.artType,
            dx: coords.x - note.x, dy: coords.y - glyphEdit.downY,
          })
        } else {
          dispatch({
            type: 'UPDATE_GLYPH_OFFSET', partId: glyphEdit.partId, measureId: glyphEdit.measureId,
            noteId: glyphEdit.noteId, pitchIndex: glyphEdit.pitchIndex, kind: glyphEdit.kind as 'accidental' | 'dot',
            ax: coords.x - note.x, dy: coords.y - glyphEdit.downY,
          })
        }
      }
      return
    }
    // Commit a slur handle drag from sharpshooter mode.
    if (slurEdit) {
      const coords = getCoords(e) ?? { x: slurEdit.curX, y: slurEdit.curY }
      const current = ties.find(t => t.id === slurEdit.tieId)?.curve
      const patch = slurEditPatch(slurEdit, coords.x, coords.y, current)
      setSlurEdit(null)
      dispatch({ type: 'UPDATE_TIE_CURVE', partId, tieId: slurEdit.tieId, curve: patch })
      return
    }
    if (isSelectMode) {
      if (moveDrag) {
        // No drag = a plain click: narrow the selection to the clicked notehead.
        if (moveDrag.deltaSteps !== 0) commitMove(moveDrag)
        else onSelectionChange?.(new Set([moveDrag.hitKey]))
        setMoveDrag(null)
        return
      }
      if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      return
    }
    if (isDeleteMode) { endErase(); return }
    if (isBroomMode) { if (broomingRef.current) commitBroom(); return }
    if (isPlaceMode) {
      // A press that didn't drift past the tolerance is a tap: place at the release point.
      // Driving this off mouseup (not the native click) survives trackpad presses that drag
      // a few px and would otherwise have the click swallowed by the browser.
      const down = placeDownRef.current
      placeDownRef.current = null
      const coords = getCoords(e)
      if (down && coords
        && Math.abs(coords.x - down.x) <= PLACE_DRAG_TOLERANCE_PX
        && Math.abs(coords.y - down.y) <= PLACE_DRAG_TOLERANCE_PX) {
        placeAt(coords.x, coords.y, false, e.altKey)
      }
      return
    }
    if (!isTieMode) return
    if (!tieDrag) return
    const coords = getCoords(e)
    const target = coords ? nearestHeadAt(coords.x, coords.y) : null
    setTieDrag(null)
    if (!target) return
    const tie = buildTie(measures, tieDrag.fromId, tieDrag.fromPitchId, target.noteId, target.pitchId)
    if (!tie) return
    dispatch({ type: 'ADD_TIES', partId, ties: [tie] })
    onTieComplete?.()
  }

  // Core placement logic shared by mouse click and Enter key. Returns the id of the
  // note/rest that was placed or modified (so the keyboard cursor can anchor to it).
  // forceNew=true bypasses all proximity logic (chord-add, rest-replace, modifier-on-
  // existing) and always appends a brand-new event. Used by the end-of-bar slot, where
  // the intent is unambiguously "add the next note" even if the stored x happens to sit
  // near the last note.
  const placeAt = (x: number, y: number, forceNew = false, altKey = false): string | null => {
    placementAppendedRef.current = false
    if (measures.length === 0) return null
    // Annotations tool: drop the armed mark at the click, anchored to the measure under it.
    if (annotationEntry && selectedAnnotation) {
      const idx = getMeasureIndexAtX(x)
      const measure = measures[idx]
      const g = layoutRef.current?.measures[idx]
      if (!measure || !g) return null
      const { annotation, edit } = buildAnnotation(selectedAnnotation, measure.id, x - g.x, y - STAVE_Y)
      dispatch({ type: 'ADD_ANNOTATION', partId, annotation })
      onAnnotationSpawned?.(edit ? annotation.id : null)
      return annotation.id
    }
    // Alt cycles down to the lower voice (voice 2); otherwise the toolbar's active voice.
    const targetVoice: VoiceNumber = altKey ? 2 : activeVoice
    const stepsDown = Math.round((y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    // Polyrhythm entry: a click on a reserved placeholder rest fills that exact slot (so other
    // slots can be left as rests, like normal entry); otherwise reserve a fresh tuplet here.
    if (tupletEntry) {
      const nearRest = nearestRestAtX(x, CHORD_PROXIMITY_X, targetVoice)
      const targetRestId = nearRest && measures[nearRest.measureIndex]?.tuplets?.some(t => t.placeholderIds?.includes(nearRest.id))
        ? nearRest.id : undefined
      const idx = targetRestId ? nearRest!.measureIndex : getMeasureIndexAtX(x)
      const measure = measures[idx]
      if (!measure) return null
      const atIndex = measure.notes.filter(n => n.voice === targetVoice).length
      let pitches: Pitch[] | null = null
      if (!isRest) {
        const pitch = staffYToPitch(snapY, STAVE_Y, clef)
        pitches = [toConcert(selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch)]
      }
      const newId = crypto.randomUUID()
      placementAppendedRef.current = true
      pendingCenterRef.current = idx
      dispatch({
        type: 'PLACE_TUPLET_NOTE', partId, measureId: measure.id, voice: targetVoice,
        played: tupletSpec.played, inSpaceOf: tupletSpec.inSpaceOf, baseDuration: tupletSpec.baseDuration, baseDots: 0,
        duration: selectedDuration, dots: isDotted ? 1 : 0, pitches, noteId: newId, atIndex, targetRestId, articulations: selArt(),
      })
      onNotePlaced?.()
      return newId
    }
    // Dot/accidental tool: apply to an existing note when aimed at one of its tones.
    // 1) precise notehead hit; 2) chord column + same staff line/space as a chord tone.
    // Otherwise fall through (e.g. chord column on a new line → ADD_CHORD_NOTE below).
    if (!forceNew && !isRest && (isDotted || selectedAccidental !== null || selectedArticulation !== null)) {
      const hit = noteHeadAt(x, snapY)
      if (hit) {
        applyModifierToExistingNote(hit.note, snapY, hit.pitchIndex); return hit.note.id
      }
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = measures[nearNote.measureIndex]
        const ev = measure?.notes.find(n => n.id === nearNote.id)
        if (ev?.type === 'note' && noteHasPitchAtStaffY(toWritten(ev.pitches), snapY, STAVE_Y, clef)) {
          applyModifierToExistingNote(nearNote, snapY)
          return nearNote.id
        }
      }
    }
    if (!forceNew && !isRest) {
      // Proximity is restricted to the target voice: a click near a voice-1 note while
      // placing into voice 2 must NOT chord onto it — it starts an independent voice-2
      // stack at that beat instead.
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X, targetVoice)
      if (nearNote) {
        const pitch = staffYToPitch(snapY, STAVE_Y, clef)
        const finalPitch = toConcert(selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch)
        const measure = measures[nearNote.measureIndex]
        const targetEv = measure?.notes.find(n => n.id === nearNote.id)
        if (measure && targetEv?.type === 'note') {
          pendingCenterRef.current = nearNote.measureIndex
          // Same rhythm in the same voice → add this tone to the chord. A different duration
          // is a distinct rhythmic event within the voice, placed right after the target.
          if (targetEv.duration === selectedDuration && targetEv.dots === (isDotted ? 1 : 0)) {
            dispatch({ type: 'ADD_CHORD_NOTE', partId, measureId: measure.id, noteId: nearNote.id, pitch: finalPitch })
            onNotePlaced?.()
            return nearNote.id
          }
          const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
          if (!noteCanFit(measure, candidate, effectiveTimeSigAt(measures, nearNote.measureIndex, timeSig), targetVoice)) { onPlaceFailed?.(); return null }
          const newId = crypto.randomUUID()
          const insertIdx = measure.notes.findIndex(n => n.id === nearNote.id) + 1
          dispatch({
            type: 'INSERT_EVENTS', partId, measureId: measure.id, index: insertIdx,
            events: [{ id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: targetVoice, articulations: selArt() }],
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
      const nearRest = nearestRestAtX(x, CHORD_PROXIMITY_X, targetVoice)
      if (nearRest) {
        const pitch = staffYToPitch(snapY, STAVE_Y, clef)
        const finalPitch = toConcert(selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch)
        const measure = measures[nearRest.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearRest.measureIndex
          const newId = crypto.randomUUID()
          dispatch({
            type: 'REPLACE_REST',
            partId,
            measureId: measure.id,
            restId: nearRest.id,
            note: { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: targetVoice, articulations: selArt() },
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
    } else if (!forceNew) {
      // Rest mode: clicking an existing note replaces it with a rest — mirror of
      // replacing a rest with a note above.
      const nearNote = nearestNoteAtX(x, CHORD_PROXIMITY_X, targetVoice)
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
            event: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0, voice: targetVoice, articulations: selArt() },
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
    if (!noteCanFit(measure, candidate, effectiveTimeSigAt(measures, idx, timeSig), targetVoice)) {
      onPlaceFailed?.()
      return null
    }
    placementAppendedRef.current = true
    pendingCenterRef.current = idx
    const newId = crypto.randomUUID()
    if (isRest) {
      dispatch({ type: 'ADD_REST', partId, measureId: measure.id, rest: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0, voice: targetVoice, articulations: selArt() } })
      onNotePlaced?.()
    } else {
      const pitch = staffYToPitch(snapY, STAVE_Y, clef)
      const finalPitch = toConcert(selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch)
      dispatch({ type: 'ADD_NOTE', partId, measureId: measure.id, note: { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: targetVoice, articulations: selArt() } })
      onNotePlaced?.()
    }
    return newId
  }
  // Stable ref so the keydown handler always calls the current closure.
  const placeAtRef = useRef(placeAt)
  placeAtRef.current = placeAt

  // Flash a measure red to signal a rejected paste (overflows the time signature).
  const flashFailMeasure = (mIdx: number) => {
    setFailMeasure(mIdx)
    if (failTimerRef.current !== null) window.clearTimeout(failTimerRef.current)
    failTimerRef.current = window.setTimeout(() => setFailMeasure(null), 450)
  }

  // Paste the clipboard at the current cursor (keyboard cursor, else mouse hover),
  // inserting before the cursor note — the "insert button" semantics. Rejected (with a
  // red flash) when the pasted events would push a voice past the measure's capacity.
  const pasteFromClipboard = () => {
    const clip = getClipboard()
    if (clip.length === 0 || !layout) return
    const kc = keyboardCursorRef.current
    const cursorX = kc?.x ?? hoverInfoRef.current?.x
    if (cursorX == null) return
    const mIdx = kc?.measureIndex ?? getMeasureIndexAtX(cursorX)
    const measure = measures[mIdx]
    if (!measure) return
    const ts = effectiveTimeSigAt(measures, mIdx, timeSig)
    const events = cloneWithFreshIds(clip)
    // Per-voice capacity guard: each voice the paste touches must still fit.
    for (const v of [1, 2] as VoiceNumber[]) {
      const add = events.filter(ev => ev.voice === v).reduce((s, ev) => s + noteBeatDuration(ev), 0)
      if (add > 0 && measureBeatCount(measure, v) + add > measureCapacity(ts) + 0.001) {
        flashFailMeasure(mIdx)
        onPlaceFailed?.()
        return
      }
    }
    const gapIndex = gapAtX(mIdx, cursorX)?.gapIndex ?? measure.notes.length
    pendingCenterRef.current = mIdx
    dispatch({ type: 'INSERT_EVENTS', partId, measureId: measure.id, index: gapIndex, events })
  }
  const pasteRef = useRef(pasteFromClipboard)
  pasteRef.current = pasteFromClipboard

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (measures.length === 0) return
    // A glyph-handle drag just finished — swallow the synthesized click so it doesn't place.
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (isSelectMode) return
    if (isDeleteMode) return
    if (isBroomMode) return
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
    if (isSharpshooterMode) return

    const coords = getCoords(e)
    if (!coords) return

    // Insert mode: clicking a gap locks it and opens the scratch staff.
    if (isInsertMode) {
      if (insertSession) return
      const session = gapAtX(getMeasureIndexAtX(coords.x), coords.x)
      if (session && measures[session.measureIndex]) { setInsertSession(session); setInsertHover(null) }
      return
    }

    // Default note placement is handled on mouseup (drag-tolerant) — see handleMouseUp.
  }

  // For the end-slot cursor, compute where the *next* note would actually begin so
  // the ghost dot previews the next slot instead of jumping to the bar line. The
  // next note's start is governed by how much horizontal space the last note
  // occupies (a function of its duration). This is visual-only — the stored cursor
  // x stays at the end slot, so placement/navigation logic is unaffected.
  const previewNextSlotX = (mIdx: number): number => {
    if (!layout) return keyboardCursor?.x ?? 0
    const g = layout.measures[mIdx]
    if (!g) return keyboardCursor?.x ?? 0
    const endSlotX = g.x + g.width - 16
    // Use all events (notes and rests): the next note begins after whatever is last.
    const notes = layout.notes
      .filter(n => n.measureIndex === mIdx)
      .sort((a, b) => a.cx - b.cx)
    // Empty measure: preview where the first note would land.
    if (notes.length === 0) return g.x + 16
    const events = measures[mIdx]?.notes ?? []
    const eventById = new Map(events.map(ev => [ev.id, ev]))
    const last = notes[notes.length - 1]
    const lastEvent = eventById.get(last.id)
    const lastBeats = lastEvent ? noteBeatDuration(lastEvent) : 1
    let gap: number
    if (notes.length >= 2) {
      // Measured: derive a real per-beat width from the rendered note span.
      const first = notes[0]
      let beatsToLast = 0
      for (let i = 0; i < notes.length - 1; i++) {
        const ev = eventById.get(notes[i].id)
        beatsToLast += ev ? noteBeatDuration(ev) : 1
      }
      const perBeat = beatsToLast > 0 ? (last.cx - first.cx) / beatsToLast : FALLBACK_PER_BEAT
      gap = perBeat * lastBeats
    } else {
      gap = FALLBACK_PER_BEAT * lastBeats
    }
    return Math.min(Math.max(last.cx + gap, last.cx + PREVIEW_MIN_GAP), endSlotX)
  }

  // When keyboard cursor is active it overrides mouse hover for the ghost-dot display.
  const activeHover: HoverInfo | null = (() => {
    if (!keyboardCursor) return hoverInfo
    const snapY = staffStepToY(keyboardCursor.stepsDown, STAVE_Y)
    // The end-slot cursor always previews a brand-new note — never a chord stack or
    // rest replacement — so keep it purple regardless of proximity to the last note.
    if (keyboardCursor.atEnd) {
      return {
        x: previewNextSlotX(keyboardCursor.measureIndex),
        snapY,
        isChordTarget: false,
        restTarget: null,
        noteTarget: null,
      }
    }
    const nearNote = nearestNoteAtX(keyboardCursor.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(keyboardCursor.x)
    return {
      x: keyboardCursor.x + (!isRest && nearNote ? flaggedTargetOffset(nearNote) : 0),
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
    // Green only when every occupied voice independently fills the measure.
    const full = incompleteVoices(measure, effectiveTimeSigAt(measures, i, timeSig)).length === 0
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

  // Empty track: no notes placed anywhere (rests don't count). Show a friendly hint
  // centered over the staff inviting the user to start playing.
  const isEmptyTrack = measures.length > 0 && measures.every(m => m.notes.every(n => n.type !== 'note'))

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
        'relative bg-white rounded-lg px-4 py-8 block w-full select-none overflow-x-auto ' +
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
        if (glyphEdit) setGlyphEdit(null)
        if (!insertSession) setInsertHover(null)
        endErase()
        if (broomingRef.current) commitBroom()
        if (moveDrag) { commitMove(moveDrag); setMoveDrag(null) }
        if (isSelectingRef.current && selectionBox) commitSelection(selectionBox)
      }}
    >
      <div className="relative inline-block">
        <div ref={containerRef} />

        {layout && (
          <AnnotationsLayer
            partId={partId}
            annotations={annotations}
            measureX={mId => {
              const i = measures.findIndex(m => m.id === mId)
              return i >= 0 && layout.measures[i] ? layout.measures[i].x : null
            }}
            staveY={STAVE_Y}
            isSharpshooterMode={isSharpshooterMode}
            editingId={editingAnnotationId}
            setEditingId={id => onAnnotationSpawned?.(id)}
            dispatch={dispatch}
          />
        )}

        {measureOverlays}
        {tempoOverlays}

        {/* Rejected-paste flash: the bar can't hold the pasted notes. */}
        {failMeasure !== null && layout?.measures[failMeasure] && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: layout.measures[failMeasure].x,
              top: STAVE_TOP_Y,
              width: layout.measures[failMeasure].width,
              height: STAVE_BOTTOM_Y - STAVE_TOP_Y,
              background: 'rgba(239,68,68,0.22)',
              border: '1.5px solid rgba(239,68,68,0.7)',
              zIndex: 17,
            }}
          />
        )}


        {/* Violet highlights for selected noteheads (per-pitch). */}
        {selectedNoteIds && layout && (() => {
          const byEvent = selectionByEvent(selectedNoteIds)
          const moveByEvent = moveDrag ? selectionByEvent(new Set(moveDrag.keys)) : null
          const moveDy = moveDrag ? moveDrag.deltaSteps * (LINE_SPACING / 2) : 0
          return layout.notes.flatMap(n => {
            const sel = byEvent.get(n.id)
            if (!sel) return []
            const dyFor = (i: number) =>
              moveByEvent && isPitchSelected(moveByEvent, n.id, i) ? moveDy : 0
            // Selected rest → highlight the whole glyph at its center.
            if (n.type === 'rest' || sel === 'all') {
              const topY = Math.min(...n.ys), botY = Math.max(...n.ys)
              return [(
                <div key={`sel-${n.id}`} className="absolute pointer-events-none"
                  style={{ left: n.cx - 10, top: topY - 10 + dyFor(0), width: 20, height: (botY - topY) + 20,
                    borderRadius: 10, background: 'rgba(139,92,246,0.30)', boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)', zIndex: 18 }} />
              )]
            }
            return [...sel].map(i => {
              const hx = n.xs[i] ?? n.x, hy = n.ys[i]
              return (
                <div key={`sel-${n.id}-${i}`} className="absolute pointer-events-none"
                  style={{ left: hx - 10, top: hy - 10 + dyFor(i), width: 20, height: 20,
                    borderRadius: 10, background: 'rgba(139,92,246,0.30)', boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)', zIndex: 18 }} />
              )
            })
          })
        })()}

        {/* Grey ghost noteheads while dragging selected heads up/down — shows where the
            heads will land (at their real displaced x) before they're committed. */}
        {moveDrag && layout && (() => {
          const byEvent = selectionByEvent(new Set(moveDrag.keys))
          const dy = moveDrag.deltaSteps * (LINE_SPACING / 2)
          return (
            <svg
              className="absolute pointer-events-none"
              style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 19, overflow: 'visible' }}
            >
              {layout.notes.flatMap(n => {
                if (n.type !== 'note') return []
                return n.ys.flatMap((y, i) => {
                  if (!isPitchSelected(byEvent, n.id, i)) return []
                  const hx = n.xs[i] ?? n.x
                  return [(
                    <ellipse
                      key={`drag-${n.id}-${i}`}
                      cx={hx} cy={y + dy} rx={6} ry={4.5}
                      transform={`rotate(-20 ${hx} ${y + dy})`}
                      fill="rgba(120,120,120,0.55)"
                    />
                  )]
                })
              })}
            </svg>
          )
        })()}

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
          const topY = Math.min(...n.ys)
          const botY = Math.max(...n.ys)
          return (
            <div
              key={`red-${n.id}`}
              className="absolute pointer-events-none"
              style={{
                left: n.cx - 10,
                top: topY - 10,
                width: 20,
                height: (botY - topY) + 20,
                borderRadius: 10,
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

        {tieDrag && (() => {
          // Both ends ride a notehead: the source, and the nearest note under the
          // cursor (lockX/lockY). Draw the slur as a grey arc bulging up — the shape
          // it will engrave to — instead of a raw straight line.
          const x1 = tieDrag.fromX, y1 = tieDrag.fromY
          const x2 = tieDrag.lockX, y2 = tieDrag.lockY
          const mx = (x1 + x2) / 2
          const my = Math.min(y1, y2) - 28
          const locked = tieDrag.lockId !== null
          return (
            <svg
              className="absolute pointer-events-none"
              style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}
            >
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none"
                stroke="rgba(120,120,120,0.7)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={locked ? undefined : '4 3'}
              />
              <circle cx={x1} cy={y1} r={4} fill="rgba(120,120,120,0.8)" />
              <circle cx={x2} cy={y2} r={4} fill={locked ? 'rgba(120,120,120,0.8)' : 'rgba(120,120,120,0.4)'} />
            </svg>
          )
        })()}

        {/* Replace-on-rest target: ring the rest the next click will overwrite. */}
        {activeHover?.restTarget && !isRest && !isTieMode && !isDeleteMode && !isBroomMode && !isInsertMode && !isSelectMode && !isSharpshooterMode && (
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
        {activeHover?.noteTarget && isRest && !isTieMode && !isDeleteMode && !isBroomMode && !isInsertMode && !isSelectMode && !isSharpshooterMode && (
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

        {activeHover && !isTieMode && !isDeleteMode && !isBroomMode && !isInsertMode && !isSelectMode && !isSharpshooterMode && (
          ghost ? (
            <>
              {/* Keep the normal cursor dot visible as the ghost-note anchor point. */}
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
                  zIndex: 19,
                }}
              />
              {/* Grey held-note glyph, notehead centered on the snapped cursor. */}
              <svg
                className="absolute pointer-events-none"
                style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 20, overflow: 'visible' }}
              >
                <g
                  transform={`translate(${activeHover.x - ghost.anchorX} ${activeHover.snapY - ghost.anchorY})`}
                  opacity={0.4}
                  dangerouslySetInnerHTML={{ __html: ghost.html }}
                />
              </svg>
            </>
          ) : (
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
          )
        )}

        {/* Slur edit handles (tie mode) — only for ties whose measure(s) the cursor
            is over, so handles don't clutter unrelated measures. The tie being
            dragged stays visible regardless. */}
        {isSharpshooterMode && layout?.ties.flatMap(geo => {
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

        {/* Accidental/dot adjust handles — only for glyphs in the hovered measure, so they
            don't clutter the rest of the staff. The glyph being dragged follows the cursor. */}
        {isSharpshooterMode && layout?.glyphs.map(g => {
          const editing = glyphEdit?.noteId === g.noteId && glyphEdit?.pitchIndex === g.pitchIndex && glyphEdit?.kind === g.kind && glyphEdit?.artType === g.artType
          const note = layout.notes.find(n => n.id === g.noteId)
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

        {/* Broom brush trail (yellow while sweeping, grey when passive) + swept marks */}
        {isBroomMode && (
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 30, overflow: 'visible' }}
          >
            {broomMarks.map(t => {
              const hl = 'rgba(251,191,36,0.35)'
              const hlStroke = 'rgba(251,191,36,0.9)'
              if (t.kind === 'tie') {
                const geo = layout?.ties.find(g => g.id === t.tieId)
                if (!geo) return null
                return <path key={t.key} d={slurArcPath(geo)} fill="none" stroke="rgba(251,191,36,0.85)" strokeWidth={9} strokeLinecap="round" />
              }
              if (t.kind === 'keySig') {
                return <rect key={t.key} x={t.x - 30} y={t.y - 26 + BROOM_KEY_SIG_DY} width={60} height={52} rx={5} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
              }
              if (t.kind === 'timeSig') {
                return <rect key={t.key} x={t.x - 16} y={t.y - 26 + BROOM_TIME_SIG_DY} width={32} height={52} rx={5} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
              }
              if (t.kind === 'tempo') {
                return <rect key={t.key} x={t.x - 30} y={t.y - 10 + BROOM_TEMPO_DY} width={60} height={20} rx={4} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
              }
              if (t.kind === 'annotation') {
                return <rect key={t.key} x={t.x} y={t.y} width={t.w} height={t.h} rx={4} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
              }
              return <circle key={t.key} cx={t.x} cy={t.y} r={9} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
            })}
            {broomTrail.map((p, i) => {
              const age = (performance.now() - p.born) / TRAIL_MS
              const op = Math.max(0, 1 - age)
              const r = 2 + op * 7
              const rgb = p.pressed ? '251,191,36' : '148,163,184'
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

      {/* Empty-track invitation — fades in and gently bobs in the white space to the
          right of the staff lines. Anchored to the card's right edge. */}
      {isEmptyTrack && layout && (
        <div
          className="empty-track-hint absolute pointer-events-none select-none flex flex-col items-end gap-2.5 text-right"
          style={{
            right: 32,
            top: CARD_PAD_Y + (STAVE_TOP_Y + STAVE_BOTTOM_Y) / 2,
            zIndex: 12,
          }}
        >
          <div
            className="flex items-center gap-3 rounded-full px-6 py-3.5 backdrop-blur-sm"
            style={{
              background: 'rgba(140,92,255,0.08)',
              border: '1px solid rgba(140,92,255,0.22)',
              boxShadow: '0 6px 28px -6px rgba(140,92,255,0.35)',
            }}
          >
            <span className="text-2xl" style={{ color: 'var(--primary)' }}>♪</span>
            <span className="text-lg font-medium" style={{ color: 'var(--primary)' }}>
              Hover and click
            </span>
            <span className="text-sm opacity-60" style={{ color: 'var(--primary)' }}>or press</span>
            <kbd
              className="rounded-md px-2 py-1 text-sm font-semibold leading-none"
              style={{ background: 'rgba(140,92,255,0.15)', color: 'var(--primary)', border: '1px solid rgba(140,92,255,0.3)' }}
            >
              ⏎
            </kbd>
            <span className="text-lg font-medium" style={{ color: 'var(--primary)' }}>
              to place a note
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-70" style={{ color: 'var(--primary)' }}>
            <span>use</span>
            {['←', '↑', '↓', '→'].map(k => (
              <kbd
                key={k}
                className="rounded px-1.5 py-1 text-xs font-semibold leading-none"
                style={{ background: 'rgba(140,92,255,0.12)', border: '1px solid rgba(140,92,255,0.25)' }}
              >
                {k}
              </kbd>
            ))}
            <span>to move around</span>
          </div>
        </div>
      )}
    </div>

      {/* Scratch staff for the locked insertion point. Lives outside the
          horizontally-scrolling card so it can flow up into the page instead of
          being clipped by the card's top edge; it tracks horizontal scroll via scrollLeft. */}
      {isInsertMode && insertSession && measures[insertSession.measureIndex] && (
        <InsertStaff
          left={CARD_PAD_X - 4 + insertSession.anchorX - scrollLeft}
          top={CARD_PAD_Y + STAVE_TOP_Y - 96 - 16}
          capacity={measureRemainingBeats(measures[insertSession.measureIndex], effectiveTimeSigAt(measures, insertSession.measureIndex, timeSig))}
          timeSig={timeSig}
          keySig={keySig}
          clef={clef}
          selectedDuration={selectedDuration}
          selectedAccidental={selectedAccidental}
          selectedArticulation={selectedArticulation}
          isDotted={isDotted}
          isRest={isRest}
          onCommit={commitInsert}
          onCancel={() => { setInsertSession(null); onInsertComplete?.() }}
          onPlaceFailed={onPlaceFailed}
        />
      )}
    </div>
  )
}
