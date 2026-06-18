import { useEffect, useRef, useState } from 'react'
import {
  renderGrandStaff,
  type GrandStaffLayout,
  type NoteGeometry,
  type TieGeometry,
  GRAND_TREBLE_Y,
  GRAND_BASS_Y,
  GRAND_STAFF_HEIGHT,
} from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, noteHasPitchAtStaffY, whichGrandStaffStave, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { measureBeatCount, measureCapacity, isMeasureFull, noteCanFit, measureRemainingBeats, noteBeatDuration, incompleteVoices, effectiveTimeSigAt } from '../../lib/beats'
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
import { diatonicStep } from '../../lib/transposition/transpose'
import { selKey, selectionByEvent, isPitchSelected, moveSelectedPitches } from './noteSelection'
import type { TimeSig, KeySig, Duration, Accidental, Part, Note, NoteEvent, VoiceNumber } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const DOT_R = 7
const CHORD_PROXIMITY_X = 20
// A flagged note's reported notehead center (cx) sits a hair right of the drawn
// notehead because notePx includes the flag, so a ghost/cursor snapped onto an
// 8th/16th lands too far right. Nudge it back left to re-center over the head.
const FLAGGED_TARGET_X_OFFSET = -5
// Accidental columns can project far left; count only part of that width for chord
// targeting so the stack zone doesn't become too sticky.
const ACCIDENTAL_ZONE_WEIGHT = 0.75
function chordProximityForBeats(beats: number): number {
  if (beats <= 0.25) return 7   // sixteenth
  if (beats <= 0.5) return 9    // eighth
  if (beats < 1) return 12      // dotted eighth (0.75)
  if (beats <= 1) return 15     // quarter
  if (beats < 2) return 17      // dotted quarter (1.5)
  return CHORD_PROXIMITY_X      // half and longer
}
const BRUSH_R = 15
const NOTEHEAD_HIT_R = 12     // px — precise click radius on a notehead (apply dot/accidental)
const NOTEHEAD_HIT_Y_TOL = 4  // px — keep half-step-above clicks from being mistaken as same head
const PLACE_DRAG_TOLERANCE_PX = 4  // px — press-and-release within this counts as a tap (places a note)

const TREBLE_TOP_Y    = GRAND_TREBLE_Y + STAVE_TOP_OFFSET
const TREBLE_BOTTOM_Y = TREBLE_TOP_Y + 4 * LINE_SPACING
const BASS_TOP_Y      = GRAND_BASS_Y + STAVE_TOP_OFFSET
const BASS_BOTTOM_Y   = BASS_TOP_Y + 4 * LINE_SPACING
const CARD_PAD = 16  // px — the card's p-4 padding; offsets content from the (unclipped) wrapper edge

// Broom highlight box offsets — tune these to align each rect with the actual glyph.
const BROOM_KEY_SIG_DY  = 30   // key signature accidentals (vertical)
const BROOM_KEY_SIG_DX  = -10  // key signature accidentals (horizontal)
const BROOM_TIME_SIG_DY = 48   // time signature digits
const BROOM_TEMPO_DY    = 8    // tempo marking text above the stave
const PANEL_EDGE_DEADBAND_PX = 10  // keep cursor from latching at panel extremes

interface HoverInfo { x: number; snapY: number; stave: 'treble' | 'bass'; isChordTarget: boolean; restTarget: { x: number; y: number } | null; noteTarget: { x: number; y: number } | null }
interface TieDrag { partId: string; fromId: string; fromPitchId: string; fromX: number; fromY: number; curX: number; curY: number; lockId: string | null; lockPitchId: string | null; lockX: number; lockY: number }

// An auxiliary glyph (accidental/dot) or tie swept by the broom, removed on release.
type BroomTarget =
  | { kind: 'glyph'; key: string; partId: string; noteId: string; pitchIndex: number; glyphKind: 'accidental' | 'dot'; x: number; y: number }
  | { kind: 'tie'; key: string; partId: string; tieId: string; x: number; y: number }
  | { kind: 'keySig'; key: string; measureIndex: number; measureNumber: number; x: number; y: number }
  | { kind: 'timeSig'; key: string; measureIndex: number; measureNumber: number; x: number; y: number }
  | { kind: 'tempo'; key: string; measureNumber: number; x: number; y: number }

// A chosen insertion point on a specific stave.
interface InsertSession {
  stave: 'treble' | 'bass'
  measureIndex: number
  gapIndex: number
  anchorX: number
}

interface KeyboardCursor {
  stepsDown: number
  x: number
  measureIndex: number
  stave: 'treble' | 'bass'
  anchorId?: string
  atEnd?: boolean
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
  activeVoice?: VoiceNumber
  isTieMode: boolean
  isFillMode: boolean
  isDeleteMode: boolean
  isBroomMode: boolean
  isInsertMode: boolean
  isSharpshooterMode?: boolean
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
  activeVoice = 1,
  isTieMode,
  isFillMode,
  isDeleteMode,
  isBroomMode,
  isInsertMode,
  isSharpshooterMode = false,
  advanceOnPlace = false,
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
  // Mousedown coords in default note-entry mode. Placement fires on mouseup (drag-tolerant)
  // rather than the native click, which a browser swallows when a trackpad press drifts.
  const placeDownRef = useRef<{ x: number; y: number } | null>(null)
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set())
  const [insertHover, setInsertHover] = useState<InsertSession | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const isSelectingRef = useRef(false)
  // Drag-move of selected notes in select mode (started on a notehead). deltaSteps is
  // the snapped vertical staff-position offset (down = positive) since the press.
  const [moveDrag, setMoveDrag] = useState<{ keys: string[]; hitKey: string; startY: number; deltaSteps: number } | null>(null)
  // Grey "held note/rest" glyph that rides the cursor in placement mode.
  const [ghost, setGhost] = useState<GhostRender | null>(null)
  const [keyboardCursor, setKeyboardCursor] = useState<KeyboardCursor | null>(null)
  const mouseInStaffRef = useRef(false)
  const layoutRef = useRef<GrandStaffLayout | null>(null)
  layoutRef.current = layout
  const hoverInfoRef = useRef<HoverInfo | null>(null)
  hoverInfoRef.current = hoverInfo
  const isSelectModeRef = useRef(isSelectMode)
  isSelectModeRef.current = isSelectMode
  // Default note-entry mode: no special tool active. Placement is driven by mousedown→mouseup.
  const isPlaceMode = !isSelectMode && !isDeleteMode && !isBroomMode && !isTieMode
    && !isSharpshooterMode && !isFillMode && !isInsertMode
  const isSharpshooterModeRef = useRef(isSharpshooterMode)
  isSharpshooterModeRef.current = isSharpshooterMode
  const keyboardCursorRef = useRef<KeyboardCursor | null>(keyboardCursor)
  keyboardCursorRef.current = keyboardCursor
  // Set by placeAt: true when the last placement appended a brand-new note/rest (vs.
  // chord-add, rest-replace, or modifier-on-existing). Lets the keyboard flow advance
  // to the next open spot after appending, while staying put when editing.
  const placementAppendedRef = useRef(false)
  // Read inside the once-bound keydown handler, so toggling it takes effect live.
  const advanceOnPlaceRef = useRef(advanceOnPlace)
  advanceOnPlaceRef.current = advanceOnPlace
  const trebleMeasuresRef = useRef(treblePart.measures)
  trebleMeasuresRef.current = treblePart.measures
  const bassMeasuresRef = useRef(bassPart.measures)
  bassMeasuresRef.current = bassPart.measures
  const timeSigRef = useRef(timeSig)
  timeSigRef.current = timeSig

  const markingRef = useRef(false)
  const markedRef = useRef<Set<string>>(new Set())  // synchronous mirror of markedIds
  const clickCooldownRef = useRef(0)
  const pendingCenterRef = useRef<number | null>(null)
  const { trail, push: pushTrail } = useDeleteTrail(isDeleteMode)
  const { trail: broomTrail, push: pushBroom } = useDeleteTrail(isBroomMode)
  const broomRef = useRef<Map<string, BroomTarget>>(new Map())
  const [broomMarks, setBroomMarks] = useState<BroomTarget[]>([])
  const broomingRef = useRef(false)
  // Stave+measure briefly flashed red when a paste is rejected for overflowing the bar.
  const [failFlash, setFailFlash] = useState<{ stave: 'treble' | 'bass'; measureIndex: number } | null>(null)
  const failTimerRef = useRef<number | null>(null)

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

  // Re-render the grey cursor ghost only when the selected note params change.
  // Clef-independent glyph, so one render serves both staves.
  useEffect(() => {
    if (isTieMode || isDeleteMode || isBroomMode || isInsertMode || isSelectMode || isFillMode || isSharpshooterMode) {
      setGhost(null)
      return
    }
    const nextGhost = renderGhostNote({
      duration: selectedDuration,
      dotted: isDotted,
      accidental: selectedAccidental,
      isRest,
      clef: 'treble',
      timeSig,
      keySig,
      voice: activeVoice,
    })
    setGhost(nextGhost)
  }, [selectedDuration, isDotted, selectedAccidental, isRest, timeSig, keySig, activeVoice,
      isTieMode, isDeleteMode, isBroomMode, isInsertMode, isSelectMode, isFillMode, isSharpshooterMode])

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
    if (isSelectMode) setHoverInfo(null)
    if (isSelectMode) setKeyboardCursor(null)
  }, [isSelectMode])

  // Leaving sharpshooter mode abandons any in-progress handle drags.
  useEffect(() => {
    if (!isSharpshooterMode) { setGlyphEdit(null); setSlurEdit(null); return }
    setHoverInfo(null)
    setKeyboardCursor(null)
  }, [isSharpshooterMode])

  useEffect(() => {
    if (!layout) return
    const kc = keyboardCursorRef.current
    if (!kc) return
    const staveNotes = kc.stave === 'treble' ? layout.trebleNotes : layout.bassNotes
    if (kc.anchorId) {
      const note = staveNotes.find(n => n.id === kc.anchorId)
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
      const measureHere = measuresForStave(kc.stave)[kc.measureIndex]
      const nextG = layout.measures[kc.measureIndex + 1]
      if (measureHere && nextG && isMeasureFull(measureHere, effectiveTimeSigAt(measuresForStave(kc.stave), kc.measureIndex, timeSig))) {
        const nextNotes = staveNotes
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

  // Per-note chord radius lookup: shorter durations get a tighter zone.
  const noteBeatsById = new Map<string, number>()
  for (const meas of treblePart.measures) for (const ev of meas.notes) noteBeatsById.set(ev.id, noteBeatDuration(ev))
  for (const meas of bassPart.measures) for (const ev of meas.notes) noteBeatsById.set(ev.id, noteBeatDuration(ev))
  const chordProximityFor = (id: string) => chordProximityForBeats(noteBeatsById.get(id) ?? 1)

  const nearestNoteAtX = (notes: NoteGeometry[], x: number, maxDist = Infinity, voice?: VoiceNumber): NoteGeometry | null => {
    const scaled = Number.isFinite(maxDist)
    let best: NoteGeometry | null = null
    let bestDist = Infinity
    let bestCenterDist = Infinity
    for (const n of notes) {
      if (n.type !== 'note') continue
      if (voice !== undefined && n.voice !== voice) continue
      const weightedLeftX = n.x - (n.x - n.leftX) * ACCIDENTAL_ZONE_WEIGHT
      // Distance to the note's horizontal span (incl. accidentals), 0 when inside it.
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

  const nearestRestAtX = (notes: NoteGeometry[], x: number, maxDist = CHORD_PROXIMITY_X, voice?: VoiceNumber): NoteGeometry | null => {
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of notes) {
      if (n.type !== 'rest') continue
      if (voice !== undefined && n.voice !== voice) continue
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  const notesForStave = (stave: 'treble' | 'bass') =>
    stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
  const measuresForStave = (stave: 'treble' | 'bass') =>
    stave === 'treble' ? trebleMeasuresRef.current : bassMeasuresRef.current
  // Leftward nudge to re-center a snapped ghost/cursor when the target note under it
  // is flagged (8th/16th), whose reported center sits a hair right of the drawn head.
  const flaggedTargetOffset = (stave: 'treble' | 'bass', target: NoteGeometry | null) => {
    if (!target) return 0
    const ev = measuresForStave(stave)[target.measureIndex]?.notes.find(n => n.id === target.id)
    return ev?.type === 'note' && (ev.duration === 'eighth' || ev.duration === 'sixteenth')
      ? FLAGGED_TARGET_X_OFFSET
      : 0
  }
  const staveOriginY = (stave: 'treble' | 'bass') =>
    stave === 'treble' ? GRAND_TREBLE_Y : GRAND_BASS_Y

  // Find the note whose notehead sits directly under (x, y) on a stave — a precise
  // hit on the glyph (used by the dot/accidental click-to-apply path).
  const noteHeadAt = (notes: NoteGeometry[], x: number, y: number): { note: NoteGeometry; pitchIndex: number } | null => {
    const r2 = NOTEHEAD_HIT_R * NOTEHEAD_HIT_R
    let best: { note: NoteGeometry; pitchIndex: number } | null = null
    let bestDist = r2
    for (const n of notes) {
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

  // Forgiving notehead pick for tie endpoints within one part: nearest note column by x,
  // then the head closest to the cursor y. Returns the head's event id, stable Pitch.id,
  // and drawn position (`measures` is the source part's, indexed by NoteGeometry.measureIndex).
  const nearestHeadAt = (
    notes: NoteGeometry[], measures: Part['measures'], x: number, y: number,
  ): { noteId: string; pitchId: string; x: number; y: number } | null => {
    const note = nearestNoteAtX(notes, x)
    if (!note || note.type !== 'note' || note.ys.length === 0) return null
    let bi = 0, bd = Infinity
    note.ys.forEach((ny, i) => { const d = Math.abs(ny - y); if (d < bd) { bd = d; bi = i } })
    const ev = measures[note.measureIndex]?.notes.find(n => n.id === note.id)
    if (!ev || ev.type !== 'note') return null
    const pitch = ev.pitches[bi]
    if (!pitch) return null
    return { noteId: note.id, pitchId: pitch.id, x: note.xs[bi] ?? note.x, y: note.ys[bi] ?? note.y }
  }

  // Apply the active modifier tool(s) — dot and/or accidental — to an existing note,
  // the accidental landing on the chord tone at the clicked staff position. onNotePlaced
  // then clears the tool selection so it doesn't carry to the next placement.
  const applyModifierToExistingNote = (part: Part, staveY: number, clef: 'treble' | 'bass', target: NoteGeometry, clickY: number, pitchIndex?: number) => {
    const measure = part.measures[target.measureIndex]
    if (!measure) return
    const ev = measure.notes.find(n => n.id === target.id)
    if (!ev || ev.type !== 'note') return
    const patch: Partial<Note> = {}
    if (isDotted) patch.dots = 1
    if (selectedAccidental !== null) {
      if (pitchIndex !== undefined && ev.pitches[pitchIndex]) {
        patch.pitches = ev.pitches.map((p, i) =>
          i === pitchIndex ? { ...p, accidental: selectedAccidental } : p,
        )
      } else {
        const clicked = staffYToPitch(clickY, staveY, clef)
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
        // Remove marked notes entirely and shift the remainder left (no in-place rests).
        const newNotes = normalizeMeasureRests(measure.notes.filter(n => !ids.has(n.id)), effectiveTimeSigAt(part.measures, mIdx, timeSig))
        edits.push({ partId: part.id, measureId: measure.id, notes: newNotes })
      }
    }
    if (edits.length === 0) return
    dispatch({ type: 'APPLY_MEASURE_NOTES', edits, removedIds })
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

  // Broom: mark only the auxiliary glyphs/ties actually under the brush at (x, y).
  const broomAt = (x: number, y: number) => {
    if (!layout) return
    let added = false
    for (const { part, glyphs } of allGlyphHandles()) {
      for (const g of glyphs) {
        if (Math.hypot(g.x - x, g.y - y) > BRUSH_R) continue
        const key = `g:${g.noteId}:${g.pitchIndex}:${g.kind}`
        if (broomRef.current.has(key)) continue
        broomRef.current.set(key, { kind: 'glyph', key, partId: part.id, noteId: g.noteId, pitchIndex: g.pitchIndex, glyphKind: g.kind, x: g.x, y: g.y })
        added = true
      }
    }
    for (const { partId, ties } of allTieHandles()) {
      for (const geo of ties) {
        const pts = slurHandlePoints(geo)
        const near = (['start', 'end', 'apex'] as const).some(h => Math.hypot(pts[h].x - x, pts[h].y - y) <= BRUSH_R)
        if (!near) continue
        const key = `t:${geo.id}`
        if (broomRef.current.has(key)) continue
        broomRef.current.set(key, { kind: 'tie', key, partId, tieId: geo.id, x: pts.apex.x, y: pts.apex.y })
        added = true
      }
    }
    for (const d of layout.decorations) {
      if (Math.hypot(d.x - x, d.y - y) > BRUSH_R * 2) continue
      const key = `d:${d.kind}:${d.measureIndex}`
      if (broomRef.current.has(key)) continue
      const measureNumber = treblePart.measures[d.measureIndex]?.number
      if (measureNumber === undefined) continue
      broomRef.current.set(key, { kind: d.kind as 'keySig' | 'timeSig', key, measureIndex: d.measureIndex, measureNumber, x: d.x, y: d.y })
      added = true
    }
    for (const tm of layout.tempoMarks) {
      if (tm.measureNumber === 1) continue
      const tmBroomX = tm.x + 28
      const tmBroomY = tm.y - 16
      if (Math.hypot(tmBroomX - x, tmBroomY - y) > BRUSH_R * 2) continue
      const key = `tempo:${tm.measureNumber}`
      if (broomRef.current.has(key)) continue
      broomRef.current.set(key, { kind: 'tempo', key, measureNumber: tm.measureNumber, x: tmBroomX, y: tmBroomY })
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
    const parts = [treblePart, bassPart]
    const glyphsByNote = new Map<string, BroomTarget[]>()
    for (const t of targets) {
      if (t.kind !== 'glyph') continue
      const arr = glyphsByNote.get(t.noteId) ?? []
      arr.push(t); glyphsByNote.set(t.noteId, arr)
    }
    for (const [noteId, gs] of glyphsByNote) {
      const partId = gs[0].partId
      const part = parts.find(p => p.id === partId)
      const measure = part?.measures.find(m => m.notes.some(n => n.id === noteId))
      const note = measure?.notes.find(n => n.id === noteId)
      if (!part || !measure || !note || note.type !== 'note') continue
      const patch: Partial<Note> = {}
      if (gs.some(g => g.kind === 'glyph' && g.glyphKind === 'dot')) patch.dots = 0
      const accIdx = new Set(gs.filter(g => g.kind === 'glyph' && g.glyphKind === 'accidental').map(g => (g as { pitchIndex: number }).pitchIndex))
      if (accIdx.size > 0) {
        patch.pitches = note.pitches.map((p, i) => accIdx.has(i) ? { ...p, accidental: null, accidentalOffset: undefined } : p)
      }
      if (Object.keys(patch).length) dispatch({ type: 'UPDATE_NOTE', partId, measureId: measure.id, noteId, patch })
    }
    for (const t of targets) {
      if (t.kind === 'tie') dispatch({ type: 'REMOVE_TIE', partId: t.partId, tieId: t.tieId })
      if (t.kind === 'keySig') {
        if (t.measureNumber === 1) {
          dispatch({ type: 'SET_GLOBAL_KEY_SIG', keySig: { fifths: 0, mode: 'major' } })
        } else {
          dispatch({ type: 'CLEAR_MEASURE_KEY_SIG', measureNumber: t.measureNumber })
        }
      }
      if (t.kind === 'timeSig') dispatch({ type: 'CLEAR_MEASURE_TIME_SIG', measureNumber: t.measureNumber })
      if (t.kind === 'tempo') dispatch({ type: 'REMOVE_MEASURE_TEMPO', measureNumber: t.measureNumber })
    }
  }

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
        if (n.type === 'rest') {
          if (n.x >= minX && n.x <= maxX && n.ys.some(y => y >= minY && y <= maxY)) ids.add(n.id)
          continue
        }
        n.ys.forEach((y, i) => {
          const hx = n.xs[i] ?? n.x
          if (hx >= minX && hx <= maxX && y >= minY && y <= maxY) ids.add(selKey(n.id, i))
        })
      }
    }
    onSelectionChange?.(ids)
  }

  // A notehead hit on either stave (for click-select / drag-move in select mode).
  const noteHeadAtAny = (x: number, y: number): { note: NoteGeometry; pitchIndex: number } | null =>
    noteHeadAt(layout?.trebleNotes ?? [], x, y) ?? noteHeadAt(layout?.bassNotes ?? [], x, y)

  // Snapped vertical staff-position delta (each line/space = one step), down = positive.
  const snapDeltaSteps = (y: number, startY: number) =>
    Math.round((y - startY) / (LINE_SPACING / 2))

  // Commit a drag-move: shift every selected notehead diatonically by the snapped delta
  // (dragging down lowers pitch) across both parts, in one undo-able edit.
  const commitMove = (drag: { keys: string[]; deltaSteps: number }) => {
    if (drag.deltaSteps === 0) return
    const byEvent = selectionByEvent(new Set(drag.keys))
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    const newKeys: string[] = []
    for (const part of [treblePart, bassPart]) {
      for (const measure of part.measures) {
        if (!measure.notes.some(n => byEvent.has(n.id))) continue
        const res = moveSelectedPitches(measure.notes, byEvent, p => diatonicStep(p, -drag.deltaSteps))
        edits.push({ partId: part.id, measureId: measure.id, notes: res.notes })
        newKeys.push(...res.newKeys)
      }
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
        // Lock the dragging end onto the nearest notehead on the source's stave, so the
        // grey preview snaps exactly where the slur will land.
        const srcIsTreble = tieDrag.partId === treblePart.id
        const srcNotes = srcIsTreble ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
        const srcMeasures = (srcIsTreble ? treblePart : bassPart).measures
        const target = nearestHeadAt(srcNotes, srcMeasures, coords.x, coords.y)
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
      setInsertHover(coords ? gapAtX(whichStave(coords.y), getMeasureIndexAtX(coords.x), coords.x) : null)
      return
    }
    if (isSharpshooterMode) {
      const c = getCoords(e)
      setHoverMeasure(c ? getMeasureIndexAtX(c.x) : null)
      if (glyphEdit && c) { setGlyphEdit({ ...glyphEdit, curX: c.x, curY: c.y }); return }
      if (slurEdit && c) { setSlurEdit({ ...slurEdit, curX: c.x, curY: c.y }); return }
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
    setKeyboardCursor(null)
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
        const hitKey = selKey(hit.note.id, hit.pitchIndex)
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
      for (const { partId, ties } of allTieHandles()) {
        const sh = hitSlurHandle(ties, coords.x, coords.y)
        if (sh) {
          setSlurEdit({ partId, ...sh, downX: coords.x, downY: coords.y, curX: coords.x, curY: coords.y })
          return
        }
      }
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
    if (isPlaceMode) { placeDownRef.current = coords; return }
    if (!isTieMode) return
    const stave = whichStave(coords.y)
    const isTreble = stave === 'treble'
    const notes = isTreble ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const part = isTreble ? treblePart : bassPart
    const head = nearestHeadAt(notes, part.measures, coords.x, coords.y)
    if (!head) return
    setTieDrag({
      partId: part.id, fromId: head.noteId, fromPitchId: head.pitchId, fromX: head.x, fromY: head.y,
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
    // Commit a slur handle drag from sharpshooter mode.
    if (slurEdit) {
      const coords = getCoords(e) ?? { x: slurEdit.curX, y: slurEdit.curY }
      const part = slurEdit.partId === treblePart.id ? treblePart : bassPart
      const current = part.ties?.find(t => t.id === slurEdit.tieId)?.curve
      const patch = slurEditPatch(slurEdit, coords.x, coords.y, current)
      setSlurEdit(null)
      dispatch({ type: 'UPDATE_TIE_CURVE', partId: slurEdit.partId, tieId: slurEdit.tieId, curve: patch })
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
    // A grand-staff tie stays within one part: resolve the target on the source's stave.
    const srcIsTreble = tieDrag.partId === treblePart.id
    const part = srcIsTreble ? treblePart : bassPart
    const notes = srcIsTreble ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const target = coords ? nearestHeadAt(notes, part.measures, coords.x, coords.y) : null
    setTieDrag(null)
    if (!target) return
    const tie = buildTie(part.measures, tieDrag.fromId, tieDrag.fromPitchId, target.noteId, target.pitchId)
    if (!tie) return
    dispatch({ type: 'ADD_TIES', partId: tieDrag.partId, ties: [tie] })
    onTieComplete?.()
  }

  // Returns the id of the note/rest placed or modified (so the keyboard cursor can
  // anchor to it), or null if nothing happened.
  const placeAt = (x: number, y: number, forceNew = false, altKey = false): string | null => {
    placementAppendedRef.current = false
    if (isSharpshooterMode) return null
    const targetVoice: VoiceNumber = altKey ? 2 : activeVoice
    const stave = whichStave(y)
    const staveY = stave === 'treble' ? GRAND_TREBLE_Y : GRAND_BASS_Y
    const part = stave === 'treble' ? treblePart : bassPart
    const notes = stave === 'treble' ? layout?.trebleNotes ?? [] : layout?.bassNotes ?? []
    const idx = getMeasureIndexAtX(x)
    const clef = stave === 'treble' ? 'treble' : 'bass'
    const snapY = staffStepToY(
      Math.round((y - (staveY + STAVE_TOP_OFFSET)) / (LINE_SPACING / 2)),
      staveY,
    )

    if (!forceNew && !isRest && (isDotted || selectedAccidental !== null)) {
      const hit = noteHeadAt(notes, x, snapY)
      if (hit) { applyModifierToExistingNote(part, staveY, clef, hit.note, snapY, hit.pitchIndex); return hit.note.id }
      const nearNote = nearestNoteAtX(notes, x, CHORD_PROXIMITY_X)
      if (nearNote) {
        const measure = part.measures[nearNote.measureIndex]
        const ev = measure?.notes.find(n => n.id === nearNote.id)
        if (ev?.type === 'note' && noteHasPitchAtStaffY(ev.pitches, snapY, staveY, clef)) {
          applyModifierToExistingNote(part, staveY, clef, nearNote, snapY)
          return nearNote.id
        }
      }
    }

    if (!forceNew && !isRest) {
      // Proximity restricted to the target voice so a click near another voice's note
      // starts an independent stack instead of chording onto it.
      const nearNote = nearestNoteAtX(notes, x, CHORD_PROXIMITY_X, targetVoice)
      if (nearNote) {
        const pitch = staffYToPitch(snapY, staveY, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = part.measures[nearNote.measureIndex]
        const targetEv = measure?.notes.find(n => n.id === nearNote.id)
        if (measure && targetEv?.type === 'note') {
          pendingCenterRef.current = nearNote.measureIndex
          // Same rhythm in the same voice → chord tone. A different duration is a distinct
          // rhythmic event within the voice, placed right after the target.
          if (targetEv.duration === selectedDuration && targetEv.dots === (isDotted ? 1 : 0)) {
            dispatch({ type: 'ADD_CHORD_NOTE', partId: part.id, measureId: measure.id, noteId: nearNote.id, pitch: finalPitch })
            onNotePlaced?.()
            return nearNote.id
          }
          const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
          if (!noteCanFit(measure, candidate, effectiveTimeSigAt(part.measures, nearNote.measureIndex, timeSig), targetVoice)) { onPlaceFailed?.(); return null }
          const newId = crypto.randomUUID()
          const insertIdx = measure.notes.findIndex(n => n.id === nearNote.id) + 1
          dispatch({
            type: 'INSERT_EVENTS', partId: part.id, measureId: measure.id, index: insertIdx,
            events: [{ id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: targetVoice }],
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
      const nearRest = nearestRestAtX(notes, x, CHORD_PROXIMITY_X, targetVoice)
      if (nearRest) {
        const pitch = staffYToPitch(snapY, staveY, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        const measure = part.measures[nearRest.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearRest.measureIndex
          const newId = crypto.randomUUID()
          dispatch({
            type: 'REPLACE_REST',
            partId: part.id,
            measureId: measure.id,
            restId: nearRest.id,
            note: { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: targetVoice },
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
    } else if (!forceNew) {
      const nearNote = nearestNoteAtX(notes, x, CHORD_PROXIMITY_X, targetVoice)
      if (nearNote) {
        const measure = part.measures[nearNote.measureIndex]
        if (measure) {
          pendingCenterRef.current = nearNote.measureIndex
          const newId = crypto.randomUUID()
          dispatch({
            type: 'REPLACE_EVENT',
            partId: part.id,
            measureId: measure.id,
            eventId: nearNote.id,
            event: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0, voice: targetVoice },
          })
          onNotePlaced?.()
          return newId
        }
        return null
      }
    }

    const measure = part.measures[idx]
    if (!measure) return null
    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (!noteCanFit(measure, candidate, effectiveTimeSigAt(part.measures, idx, timeSig), targetVoice)) { onPlaceFailed?.(); return null }
    placementAppendedRef.current = true
    pendingCenterRef.current = idx
    const newId = crypto.randomUUID()

    if (isRest) {
      dispatch({
        type: 'ADD_REST',
        partId: part.id,
        measureId: measure.id,
        rest: { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0, voice: targetVoice },
      })
      onNotePlaced?.()
      return newId
    }

    const pitch = staffYToPitch(snapY, staveY, clef)
    const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
    dispatch({
      type: 'ADD_NOTE',
      partId: part.id,
      measureId: measure.id,
      note: {
        id: newId,
        type: 'note',
        pitches: [finalPitch],
        duration: selectedDuration,
        dots: isDotted ? 1 : 0,
        tied: false,
        voice: targetVoice,
      },
    })
    onNotePlaced?.()
    return newId
  }
  // Stable ref so the keydown handler always calls the current closure.
  const placeAtRef = useRef(placeAt)
  placeAtRef.current = placeAt

  // Flash a measure red on the given stave to signal a rejected paste.
  const flashFail = (stave: 'treble' | 'bass', measureIndex: number) => {
    setFailFlash({ stave, measureIndex })
    if (failTimerRef.current !== null) window.clearTimeout(failTimerRef.current)
    failTimerRef.current = window.setTimeout(() => setFailFlash(null), 450)
  }

  // Paste the clipboard at the cursor (keyboard cursor, else mouse hover) on its stave,
  // inserting before the cursor note. Rejected (red flash) when it overflows the bar.
  const pasteFromClipboard = () => {
    const clip = getClipboard()
    if (clip.length === 0 || !layout) return
    const kc = keyboardCursorRef.current
    const stave: 'treble' | 'bass' = kc?.stave ?? hoverInfoRef.current?.stave ?? 'treble'
    const cursorX = kc?.x ?? hoverInfoRef.current?.x
    if (cursorX == null) return
    const mIdx = kc?.measureIndex ?? getMeasureIndexAtX(cursorX)
    const part = stave === 'treble' ? treblePart : bassPart
    const measure = part.measures[mIdx]
    if (!measure) return
    const ts = effectiveTimeSigAt(part.measures, mIdx, timeSig)
    const events = cloneWithFreshIds(clip)
    for (const v of [1, 2] as VoiceNumber[]) {
      const add = events.filter(ev => ev.voice === v).reduce((s, ev) => s + noteBeatDuration(ev), 0)
      if (add > 0 && measureBeatCount(measure, v) + add > measureCapacity(ts) + 0.001) {
        flashFail(stave, mIdx)
        onPlaceFailed?.()
        return
      }
    }
    const gapIndex = gapAtX(stave, mIdx, cursorX)?.gapIndex ?? measure.notes.length
    pendingCenterRef.current = mIdx
    dispatch({ type: 'INSERT_EVENTS', partId: part.id, measureId: measure.id, index: gapIndex, events })
  }
  const pasteRef = useRef(pasteFromClipboard)
  pasteRef.current = pasteFromClipboard

  const previewNextSlotX = (stave: 'treble' | 'bass', mIdx: number): number => {
    if (!layout) return keyboardCursor?.x ?? 0
    const g = layout.measures[mIdx]
    if (!g) return keyboardCursor?.x ?? 0
    const endSlotX = g.x + g.width - 16
    const notes = notesForStave(stave).filter(n => n.measureIndex === mIdx).sort((a, b) => a.cx - b.cx)
    if (notes.length === 0) return g.x + 16
    const events = measuresForStave(stave)[mIdx]?.notes ?? []
    const eventById = new Map(events.map(ev => [ev.id, ev]))
    const last = notes[notes.length - 1]
    const lastEvent = eventById.get(last.id)
    const lastBeats = lastEvent ? noteBeatDuration(lastEvent) : 1
    let gap = 30 * lastBeats
    if (notes.length >= 2) {
      const first = notes[0]
      let beatsToLast = 0
      for (let i = 0; i < notes.length - 1; i++) {
        const ev = eventById.get(notes[i].id)
        beatsToLast += ev ? noteBeatDuration(ev) : 1
      }
      const perBeat = beatsToLast > 0 ? (last.cx - first.cx) / beatsToLast : 30
      gap = perBeat * lastBeats
    }
    return Math.min(Math.max(last.cx + gap, last.cx + 18), endSlotX)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!mouseInStaffRef.current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteRef.current()
        return
      }
      if (isSelectModeRef.current || isSharpshooterModeRef.current) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return

      const currentLayout = layoutRef.current
      const hover = hoverInfoRef.current
      const baseCursor = (() => {
        if (keyboardCursorRef.current) return keyboardCursorRef.current
        if (!hover || !currentLayout) return null
        const baseY = staveOriginY(hover.stave) + STAVE_TOP_OFFSET
        const stepsDown = Math.round((hover.snapY - baseY) / (LINE_SPACING / 2))
        const mIdx = (() => {
          for (let i = 0; i < currentLayout.measures.length; i++) {
            const g = currentLayout.measures[i]
            if (hover.x >= g.x && hover.x < g.x + g.width) return i
          }
          return currentLayout.measures.length - 1
        })()
        return { stepsDown, x: hover.x, measureIndex: mIdx, stave: hover.stave } as KeyboardCursor
      })()
      if (!baseCursor) return

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setKeyboardCursor({ ...baseCursor, stepsDown: baseCursor.stepsDown - 1 })
          break
        case 'ArrowDown':
          e.preventDefault()
          setKeyboardCursor({ ...baseCursor, stepsDown: baseCursor.stepsDown + 1 })
          break
        case 'ArrowLeft': {
          e.preventDefault()
          if (!currentLayout) break
          const staveNotes = baseCursor.stave === 'treble' ? currentLayout.trebleNotes : currentLayout.bassNotes
          const notesInM = staveNotes
            .filter(n => n.measureIndex === baseCursor.measureIndex)
            .sort((a, b) => a.x - b.x)
          const prev = [...notesInM].reverse().find(n => n.cx < baseCursor.x - 1)
          if (prev) {
            setKeyboardCursor({ ...baseCursor, x: prev.cx, anchorId: prev.id, atEnd: false })
            break
          }
          const prevG = currentLayout.measures[baseCursor.measureIndex - 1]
          if (prevG) {
            const prevNotes = staveNotes
              .filter(n => n.measureIndex === baseCursor.measureIndex - 1)
              .sort((a, b) => a.cx - b.cx)
            const last = prevNotes[prevNotes.length - 1]
            const targetX = last ? last.cx : prevG.x + prevG.width - 16
            setKeyboardCursor({
              ...baseCursor,
              x: targetX,
              measureIndex: baseCursor.measureIndex - 1,
              anchorId: last?.id,
              atEnd: !last,
            })
          }
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (!currentLayout) break
          const mIdx = baseCursor.measureIndex
          const g = currentLayout.measures[mIdx]
          const staveNotes = baseCursor.stave === 'treble' ? currentLayout.trebleNotes : currentLayout.bassNotes
          const notesInM = staveNotes
            .filter(n => n.measureIndex === mIdx)
            .sort((a, b) => a.x - b.x)
          const next = notesInM.find(n => n.cx > baseCursor.x + 1)
          if (next) {
            setKeyboardCursor({ ...baseCursor, x: next.cx, anchorId: next.id, atEnd: false })
            break
          }
          const measureHere = measuresForStave(baseCursor.stave)[mIdx]
          const full = measureHere ? isMeasureFull(measureHere, effectiveTimeSigAt(measuresForStave(baseCursor.stave), mIdx, timeSigRef.current)) : false
          const endSlotX = g ? g.x + g.width - 16 : baseCursor.x
          if (!full && !baseCursor.atEnd) {
            setKeyboardCursor({ ...baseCursor, x: endSlotX, anchorId: undefined, atEnd: true })
            break
          }
          const nextG = currentLayout.measures[mIdx + 1]
          if (nextG) {
            const nextNotes = staveNotes
              .filter(n => n.measureIndex === mIdx + 1)
              .sort((a, b) => a.cx - b.cx)
            const first = nextNotes[0]
            setKeyboardCursor({
              ...baseCursor,
              x: first ? first.cx : nextG.x + 16,
              measureIndex: mIdx + 1,
              anchorId: first?.id,
              atEnd: false,
            })
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          const snapY = staffStepToY(baseCursor.stepsDown, staveOriginY(baseCursor.stave))
          const placedId = placeAtRef.current(baseCursor.x, snapY, baseCursor.atEnd === true)
          if (placedId) {
            // Free mouse hover (not locked into a keyboard slot): leave the cursor where
            // it was — no teleport to the end slot or placed note.
            const locked = keyboardCursorRef.current !== null
            if (!locked) {
              // do nothing — the hovering cursor stays put
            } else if (placementAppendedRef.current) {
              // Appended a new note. With auto-advance on (default), hover the next open
              // spot of that measure (if this filled the bar, the reflow effect advances to
              // the next measure). With it off, stay anchored on the note just placed.
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

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // A glyph-handle drag just finished — swallow the synthesized click so it doesn't place.
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (isSelectMode || isTieMode || isDeleteMode || isBroomMode || isSharpshooterMode) return
    const coords = getCoords(e)
    if (!coords) return
    const stave = whichStave(coords.y)
    const part = stave === 'treble' ? treblePart : bassPart
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

    // Default note placement is handled on mouseup (drag-tolerant) — see handleMouseUp.
  }

  // Validity overlays for both staves
  const measureOverlays = layout?.measures.flatMap((g, i) => {
    const elems = []
    const tm = treblePart.measures[i]
    const bm = bassPart.measures[i]
    if (tm && measureBeatCount(tm) > 0.001) {
      const full = incompleteVoices(tm, effectiveTimeSigAt(treblePart.measures, i, timeSig)).length === 0
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
      const full = incompleteVoices(bm, effectiveTimeSigAt(bassPart.measures, i, timeSig)).length === 0
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

  // Empty track: no notes placed in either stave (rests don't count). Show a friendly
  // hint centered over the grand staff inviting the user to start playing.
  const isEmptyTrack =
    (treblePart.measures.length > 0 || bassPart.measures.length > 0) &&
    treblePart.measures.every(m => m.notes.every(n => n.type !== 'note')) &&
    bassPart.measures.every(m => m.notes.every(n => n.type !== 'note'))

  const tempoOverlays = layout?.tempoMarks.map(tm => (
    <div
      key={`tempo-${tm.measureNumber}`}
      className="absolute pointer-events-none select-none"
      style={{ left: tm.x + 4, top: GRAND_TREBLE_Y - 22, zIndex: 10 }}
    >
      <span className="text-[11px] text-black/70 font-medium">♩ = {tm.tempo}</span>
    </div>
  ))

  const activeHover: HoverInfo | null = (() => {
    if (!keyboardCursor) return hoverInfo
    const snapY = staffStepToY(keyboardCursor.stepsDown, staveOriginY(keyboardCursor.stave))
    if (keyboardCursor.atEnd) {
      return {
        x: previewNextSlotX(keyboardCursor.stave, keyboardCursor.measureIndex),
        snapY,
        stave: keyboardCursor.stave,
        isChordTarget: false,
        restTarget: null,
        noteTarget: null,
      }
    }
    const notes = notesForStave(keyboardCursor.stave)
    const nearNote = nearestNoteAtX(notes, keyboardCursor.x, CHORD_PROXIMITY_X)
    const nearRest = nearNote ? null : nearestRestAtX(notes, keyboardCursor.x)
    return {
      x: keyboardCursor.x + (!isRest && nearNote ? flaggedTargetOffset(keyboardCursor.stave, nearNote) : 0),
      snapY,
      stave: keyboardCursor.stave,
      isChordTarget: !isRest && !!nearNote,
      restTarget: !isRest && nearRest ? { x: nearRest.cx, y: nearRest.y } : null,
      noteTarget: isRest && nearNote ? { x: nearNote.cx, y: nearNote.y } : null,
    }
  })()


  return (
    <div className="relative">
    <div
      ref={el => { scrollRef.current = el; scrollSync?.register(el) }}
      onScroll={() => { if (scrollRef.current) { scrollSync?.onScroll(scrollRef.current); setScrollLeft(scrollRef.current.scrollLeft) } }}
      className={
        'relative bg-white rounded-lg p-4 block w-full select-none overflow-x-auto ' +
        (isTieMode || isFillMode || isDeleteMode || isInsertMode ? 'cursor-pointer' : 'cursor-crosshair')
      }
      style={{ minHeight: GRAND_STAFF_HEIGHT + 32 }}
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
        {measureOverlays}
        {tempoOverlays}

        {/* Rejected-paste flash on the target stave. */}
        {failFlash && layout?.measures[failFlash.measureIndex] && (() => {
          const g = layout.measures[failFlash.measureIndex]
          const top = failFlash.stave === 'treble' ? TREBLE_TOP_Y : BASS_TOP_Y
          const h = failFlash.stave === 'treble' ? TREBLE_BOTTOM_Y - TREBLE_TOP_Y : BASS_BOTTOM_Y - BASS_TOP_Y
          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: g.x, top, width: g.width, height: h,
                background: 'rgba(239,68,68,0.22)',
                border: '1.5px solid rgba(239,68,68,0.7)',
                zIndex: 17,
              }}
            />
          )
        })()}

        {/* Violet highlights for selected noteheads (per-pitch). */}
        {selectedNoteIds && layout && (() => {
          const byEvent = selectionByEvent(selectedNoteIds)
          const moveByEvent = moveDrag ? selectionByEvent(new Set(moveDrag.keys)) : null
          const moveDy = moveDrag ? moveDrag.deltaSteps * (LINE_SPACING / 2) : 0
          return [...layout.trebleNotes, ...layout.bassNotes].flatMap(n => {
            const sel = byEvent.get(n.id)
            if (!sel) return []
            const dyFor = (i: number) =>
              moveByEvent && isPitchSelected(moveByEvent, n.id, i) ? moveDy : 0
            if (n.type === 'rest' || sel === 'all') {
              const topY = Math.min(...n.ys), botY = Math.max(...n.ys)
              return [(
                <div key={`sel-${n.id}`} className="absolute pointer-events-none"
                  style={{ left: n.cx - 10, top: topY - 10 + dyFor(0), width: 20, height: (botY - topY) + 20, borderRadius: 10,
                    background: 'rgba(139,92,246,0.30)', boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)', zIndex: 18 }} />
              )]
            }
            return [...sel].map(i => {
              const hx = n.xs[i] ?? n.x, hy = n.ys[i]
              return (
                <div key={`sel-${n.id}-${i}`} className="absolute pointer-events-none"
                  style={{ left: hx - 10, top: hy - 10 + dyFor(i), width: 20, height: 20, borderRadius: 10,
                    background: 'rgba(139,92,246,0.30)', boxShadow: '0 0 10px 4px rgba(139,92,246,0.35)', zIndex: 18 }} />
              )
            })
          })
        })()}

        {/* Grey ghost noteheads while dragging selected heads up/down (real displaced x). */}
        {moveDrag && layout && (() => {
          const byEvent = selectionByEvent(new Set(moveDrag.keys))
          const dy = moveDrag.deltaSteps * (LINE_SPACING / 2)
          return (
            <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 19, overflow: 'visible' }}>
              {[...layout.trebleNotes, ...layout.bassNotes].flatMap(n => {
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
          const topY = Math.min(...n.ys)
          const botY = Math.max(...n.ys)
          return (
            <div
              key={`red-${n.id}`}
              className="absolute pointer-events-none"
              style={{
                left: n.cx - 10, top: topY - 10, width: 20, height: (botY - topY) + 20, borderRadius: 10,
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

        {tieDrag && (() => {
          // Both ends ride a notehead: the source, and the nearest note under the
          // cursor (lockX/lockY). Draw the slur as a grey arc — the shape it will
          // engrave to — rather than a straight line.
          const x1 = tieDrag.fromX, y1 = tieDrag.fromY
          const x2 = tieDrag.lockX, y2 = tieDrag.lockY
          const mx = (x1 + x2) / 2
          const my = Math.min(y1, y2) - 28
          const locked = tieDrag.lockId !== null
          return (
            <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 25, overflow: 'visible' }}>
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none" stroke="rgba(120,120,120,0.7)" strokeWidth={2.5} strokeLinecap="round"
                strokeDasharray={locked ? undefined : '4 3'}
              />
              <circle cx={x1} cy={y1} r={4} fill="rgba(120,120,120,0.8)" />
              <circle cx={x2} cy={y2} r={4} fill={locked ? 'rgba(120,120,120,0.8)' : 'rgba(120,120,120,0.4)'} />
            </svg>
          )
        })()}

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
          ) : !isRest && (
            <div
              className="absolute pointer-events-none rounded-full"
              style={{
                left: activeHover.x - DOT_R,
                top: activeHover.snapY - DOT_R,
                width: DOT_R * 2,
                height: DOT_R * 2,
                background: activeHover.isChordTarget ? 'rgba(251,191,36,0.85)' : 'rgba(139,92,246,0.75)',
                boxShadow: activeHover.isChordTarget ? '0 0 14px 7px rgba(251,191,36,0.30)' : '0 0 14px 7px rgba(139,92,246,0.35)',
                zIndex: 20,
              }}
            />
          )
        )}

        {/* Slur edit handles (tie mode) — only for ties whose measure(s) the cursor
            is over, so handles don't clutter unrelated measures. The tie being
            dragged stays visible regardless. */}
        {isSharpshooterMode && allTieHandles().flatMap(({ ties }) =>
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
        {isSharpshooterMode && allGlyphHandles().flatMap(({ glyphs, notes }) =>
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

        {/* Broom brush trail (yellow while sweeping, grey when passive) + swept marks */}
        {isBroomMode && (
          <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 30, overflow: 'visible' }}>
            {(() => {
              const tieGeoById = new Map<string, TieGeometry>()
              for (const { ties } of allTieHandles()) for (const g of ties) tieGeoById.set(g.id, g)
              return broomMarks.map(t => {
                const hl = 'rgba(251,191,36,0.35)'
                const hlStroke = 'rgba(251,191,36,0.9)'
                if (t.kind === 'tie') {
                  const geo = tieGeoById.get(t.tieId)
                  if (!geo) return null
                  return <path key={t.key} d={slurArcPath(geo)} fill="none" stroke="rgba(251,191,36,0.85)" strokeWidth={9} strokeLinecap="round" />
                }
                if (t.kind === 'keySig') {
                  return <rect key={t.key} x={t.x - 30 + BROOM_KEY_SIG_DX} y={t.y - 26 + BROOM_KEY_SIG_DY} width={60} height={52} rx={5} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
                }
                if (t.kind === 'timeSig') {
                  return <rect key={t.key} x={t.x - 16} y={t.y - 26 + BROOM_TIME_SIG_DY} width={32} height={52} rx={5} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
                }
                if (t.kind === 'tempo') {
                  return <rect key={t.key} x={t.x - 30} y={t.y - 10 + BROOM_TEMPO_DY} width={60} height={20} rx={4} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
                }
                return <circle key={t.key} cx={t.x} cy={t.y} r={9} fill={hl} stroke={hlStroke} strokeWidth={1.5} />
              })
            })()}
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

      {/* Empty-track invitation — fades in and gently bobs in the white space to the
          right of the staff lines. Anchored to the card's right edge. */}
      {isEmptyTrack && layout && (
        <div
          className="empty-track-hint absolute pointer-events-none select-none flex flex-col items-end gap-2.5 text-right"
          style={{
            right: 32,
            top: CARD_PAD + (TREBLE_TOP_Y + BASS_BOTTOM_Y) / 2,
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
      {isInsertMode && insertSession && (() => {
        const part = insertSession.stave === 'treble' ? treblePart : bassPart
        const measure = part.measures[insertSession.measureIndex]
        if (!measure) return null
        const topY = insertSession.stave === 'treble' ? TREBLE_TOP_Y : BASS_TOP_Y
        return (
          <InsertStaff
            left={CARD_PAD - 4 + insertSession.anchorX - scrollLeft}
            top={CARD_PAD + topY - 96 - 16}
            capacity={measureRemainingBeats(measure, effectiveTimeSigAt(part.measures, insertSession.measureIndex, timeSig))}
            timeSig={timeSig}
            keySig={keySig}
            clef={insertSession.stave === 'treble' ? 'treble' : 'bass'}
            selectedDuration={selectedDuration}
            selectedAccidental={selectedAccidental}
            isDotted={isDotted}
            isRest={isRest}
            onCommit={commitInsert}
            onCancel={() => { setInsertSession(null); onInsertComplete?.() }}
            onPlaceFailed={onPlaceFailed}
          />
        )
      })()}
    </div>
  )
}
