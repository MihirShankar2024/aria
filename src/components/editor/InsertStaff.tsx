import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { renderStaff, type StaffLayout, type NoteGeometry, STAFF_HEIGHT } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { noteBeatDuration } from '../../lib/beats'
import type { Measure, TimeSig, KeySig, Duration, Accidental, Clef, NoteEvent, Pitch } from '../../types/score'

const STAVE_Y = 48
const DOT_R = 7
const CHORD_PROXIMITY_X = 20
const EPS = 0.001
// How far the physical mouse must move before it reclaims the cursor from
// keyboard (arrow-key) navigation. Below this, jitter is ignored.
const MOUSE_TAKEOVER_PX = 6

const STAVE_TOP_Y = STAVE_Y + STAVE_TOP_OFFSET

// The rendered staff SVG has asymmetric headroom: ~96px above the top staff
// line but only ~48px below the bottom line. Crop the extra top headroom so the
// padding above the staff matches the padding below (48/48), which also lifts
// the staff content up inside the overlay. The container is translated up by
// CROP_TOP so the cropped region is hidden cleanly.
const CROP_TOP = 48
const WINDOW_H = STAFF_HEIGHT - CROP_TOP
// How far above the caller-provided `top` to lift the overlay so the scratch
// staff lines visually align with the main staff (= the SVG's top headroom).
const STAFF_LINES_OFFSET = STAVE_Y

interface InsertStaffProps {
  /** Position of the overlay (main-canvas coordinates). */
  left: number
  top: number
  /** Free beats available in the target measure — the scratch can fill up to this. */
  capacity: number
  timeSig: TimeSig
  keySig: KeySig
  clef: Clef
  selectedDuration: Duration
  selectedAccidental: Accidental
  isDotted: boolean
  isRest: boolean
  onCommit: (events: NoteEvent[]) => void
  onCancel: () => void
}

const STEP_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
function sortPitches(pitches: Pitch[]): Pitch[] {
  return [...pitches].sort((a, b) =>
    a.octave !== b.octave ? a.octave - b.octave : STEP_ORDER[a.step] - STEP_ORDER[b.step],
  )
}

export function InsertStaff({
  left,
  top,
  capacity,
  timeSig,
  keySig,
  clef,
  selectedDuration,
  selectedAccidental,
  isDotted,
  isRest,
  onCommit,
  onCancel,
}: InsertStaffProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scratch, setScratch] = useState<NoteEvent[]>([])
  const [layout, setLayout] = useState<StaffLayout | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{ x: number; snapY: number; isChordTarget: boolean } | null>(null)

  // Keyboard cursor: arrow keys nudge the cursor on top of the live mouse hover.
  // Mirrors the main StaffCanvas behaviour (anchor to note id / pin to end slot so
  // the cursor stays put as the scratch staff reflows).
  const [keyboardCursor, setKeyboardCursor] = useState<{
    stepsDown: number
    x: number
    anchorId?: string
    atEnd?: boolean
  } | null>(null)

  const scratchMeasure: Measure = { id: 'scratch', number: 1, notes: scratch }

  // Stable refs so the once-subscribed keydown handler never reads stale values.
  const keyboardCursorRef = useRef(keyboardCursor)
  keyboardCursorRef.current = keyboardCursor
  const layoutRef = useRef<StaffLayout | null>(null)
  layoutRef.current = layout
  const hoverInfoRef = useRef(hoverInfo)
  hoverInfoRef.current = hoverInfo
  const mouseInStaffRef = useRef(false)
  // Last raw pointer position, and the pointer position captured when keyboard
  // navigation last took over. Browsers can't move the OS cursor, so instead we
  // ignore tiny mouse jitter while a keyboard cursor is active — control only
  // returns to the mouse once it moves past MOUSE_TAKEOVER_PX from that anchor.
  const mouseScreenRef = useRef({ x: 0, y: 0 })
  const kbAnchorRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    try {
      setLayout(renderStaff({ container: containerRef.current, measures: [scratchMeasure], timeSig, keySig, clef, staveY: STAVE_Y }))
    } catch (err) {
      console.error('Insert staff render failed', err)
    }
  }, [scratch, timeSig, keySig, clef])

  // After the scratch reflows, keep the keyboard cursor on its anchored note (or
  // pinned to the end slot) instead of drifting to a stale pixel x.
  useEffect(() => {
    if (!layout) return
    const kc = keyboardCursorRef.current
    if (!kc) return
    if (kc.anchorId) {
      const note = layout.notes.find(n => n.id === kc.anchorId)
      if (!note) return
      if (Math.abs(note.cx - kc.x) > 0.5) setKeyboardCursor({ ...kc, x: note.cx })
      return
    }
    if (kc.atEnd) {
      const g = layout.measures[0]
      if (!g) return
      const endX = g.x + g.width - 16
      if (Math.abs(endX - kc.x) > 0.5) setKeyboardCursor({ ...kc, x: endX })
    }
  }, [layout])

  const beats = scratch.reduce((sum, n) => sum + noteBeatDuration(n), 0)
  const full = Math.abs(beats - capacity) < EPS

  const getCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const nearestNoteAtX = (x: number, maxDist = CHORD_PROXIMITY_X): NoteGeometry | null => {
    if (!layout) return null
    let best: NoteGeometry | null = null
    let bestDist = maxDist
    for (const n of layout.notes) {
      if (n.type !== 'note') continue
      // Distance to the note's horizontal span (incl. accidentals), 0 when inside it.
      const d = x < n.leftX ? n.leftX - x : x > n.rightX ? x - n.rightX : 0
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return
    mouseScreenRef.current = { x: e.clientX, y: e.clientY }
    // While a keyboard cursor is active, ignore small pointer jitter so the
    // keyboard position isn't lost the instant the mouse twitches. Only once
    // the pointer travels past the takeover threshold does the mouse reclaim it.
    if (keyboardCursorRef.current && kbAnchorRef.current) {
      const dx = e.clientX - kbAnchorRef.current.x
      const dy = e.clientY - kbAnchorRef.current.y
      if (Math.hypot(dx, dy) < MOUSE_TAKEOVER_PX) return
    }
    // Mouse moved deliberately — it reclaims priority over the keyboard cursor.
    kbAnchorRef.current = null
    setKeyboardCursor(null)
    const stepsDown = Math.round((coords.y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    // In rest mode pitch is irrelevant, but the cursor still follows vertically.
    if (isRest) { setHoverInfo({ x: coords.x, snapY, isChordTarget: false }); return }
    setHoverInfo({ x: coords.x, snapY, isChordTarget: !!nearestNoteAtX(coords.x) })
  }

  // Core placement shared by mouse click and Enter. Returns the affected scratch
  // event id (so the keyboard cursor can anchor to it).
  const placeAt = (x: number, y: number): string | null => {
    // Chord-stack onto an existing scratch note (no extra duration).
    if (!isRest) {
      const near = nearestNoteAtX(x)
      if (near) {
        const pitch = staffYToPitch(y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        setScratch(s =>
          s.map(n => {
            if (n.id !== near.id || n.type !== 'note') return n
            const has = n.pitches.some(p => p.step === finalPitch.step && p.octave === finalPitch.octave && p.accidental === finalPitch.accidental)
            return has ? n : { ...n, pitches: sortPitches([...n.pitches, finalPitch]) }
          }),
        )
        return near.id
      }
    }

    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (beats + noteBeatDuration(candidate) > capacity + EPS) return null  // would overflow the target measure

    const newId = crypto.randomUUID()
    if (isRest) {
      setScratch(s => [...s, { id: newId, type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0, voice: 1 }])
    } else {
      const pitch = staffYToPitch(y, STAVE_Y, clef)
      const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
      setScratch(s => [...s, { id: newId, type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false, voice: 1 }])
    }
    return newId
  }
  const placeAtRef = useRef(placeAt)
  placeAtRef.current = placeAt

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return
    placeAt(coords.x, coords.y)
  }

  // Keyboard cursor + commit-on-Enter, plus Backspace (undo last) / Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Backspace') { e.preventDefault(); setScratch(s => s.slice(0, -1)); return }
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (!mouseInStaffRef.current) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return

      const currentLayout = layoutRef.current
      const hover = hoverInfoRef.current
      const baseCursor = (() => {
        if (keyboardCursorRef.current) return keyboardCursorRef.current
        if (!hover) return null
        const stepsDown = Math.round((hover.snapY - STAVE_TOP_Y) / (LINE_SPACING / 2))
        return { stepsDown, x: hover.x } as { stepsDown: number; x: number; anchorId?: string; atEnd?: boolean }
      })()
      if (!baseCursor) return

      // Anchor the takeover threshold to wherever the mouse currently sits, so
      // subsequent jitter is measured from here (not from a stale anchor).
      kbAnchorRef.current = { ...mouseScreenRef.current }

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
          const notes = currentLayout.notes.slice().sort((a, b) => a.cx - b.cx)
          const prev = [...notes].reverse().find(n => n.cx < baseCursor.x - 1)
          if (prev) setKeyboardCursor({ ...baseCursor, x: prev.cx, anchorId: prev.id, atEnd: false })
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (!currentLayout) break
          const notes = currentLayout.notes.slice().sort((a, b) => a.cx - b.cx)
          const next = notes.find(n => n.cx > baseCursor.x + 1)
          if (next) {
            setKeyboardCursor({ ...baseCursor, x: next.cx, anchorId: next.id, atEnd: false })
          } else {
            const g = currentLayout.measures[0]
            const endX = g ? g.x + g.width - 16 : baseCursor.x
            setKeyboardCursor({ ...baseCursor, x: endX, anchorId: undefined, atEnd: true })
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          const snapY = staffStepToY(baseCursor.stepsDown, STAVE_Y)
          const placedId = placeAtRef.current(baseCursor.x, snapY)
          if (placedId && !baseCursor.atEnd) setKeyboardCursor({ ...baseCursor, anchorId: placedId, atEnd: false })
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  // Keyboard cursor overrides mouse hover for the ghost-dot display when active.
  const activeHover = (() => {
    if (!keyboardCursor) return hoverInfo
    const snapY = staffStepToY(keyboardCursor.stepsDown, STAVE_Y)
    return { x: keyboardCursor.x, snapY, isChordTarget: !!nearestNoteAtX(keyboardCursor.x) }
  })()

  const accent = full ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)'
  const bg = full ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'

  return (
    <div
      className="absolute flex items-center gap-1.5"
      // Lift the overlay so the rendered staff lines (which sit STAFF_LINES_OFFSET
      // px down inside the full-height SVG) align with the main staff at `top`.
      style={{ left, top: top - STAFF_LINES_OFFSET, zIndex: 40 }}
      // Keep clicks inside the overlay from falling through to the staff beneath.
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        className="rounded-md overflow-hidden shadow-lg cursor-crosshair"
        // Solid white base (so high notes/ledger lines stay legible even over the
        // dark purple app background) with the full/not-full tint layered on top.
        style={{ border: `2px solid ${accent}`, background: `linear-gradient(${bg}, ${bg}), #ffffff`, height: WINDOW_H }}
      >
        <div
          className="relative inline-block"
          style={{ transform: `translateY(${-CROP_TOP}px)` }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => { mouseInStaffRef.current = true }}
          onMouseLeave={() => { mouseInStaffRef.current = false; kbAnchorRef.current = null; setHoverInfo(null); setKeyboardCursor(null) }}
        >
          <div ref={containerRef} />
          {activeHover && (
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
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          title="Insert"
          onClick={() => onCommit(scratch)}
          disabled={scratch.length === 0}
          className="h-8 w-8 grid place-items-center rounded-md bg-violet-600 text-white shadow-md ring-1 ring-black/10 hover:bg-violet-700 disabled:opacity-40 transition-colors"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          title="Cancel"
          onClick={onCancel}
          className="h-8 w-8 grid place-items-center rounded-md bg-white text-zinc-700 shadow-md ring-1 ring-black/10 hover:bg-zinc-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
