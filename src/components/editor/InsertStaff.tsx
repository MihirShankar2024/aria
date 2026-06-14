import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { renderStaff, type StaffLayout, type NoteGeometry } from '../../lib/vexflow/renderer'
import { staffYToPitch, staffStepToY, STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'
import { noteBeatDuration } from '../../lib/beats'
import type { Measure, TimeSig, KeySig, Duration, Accidental, Clef, NoteEvent, Pitch } from '../../types/score'

const STAVE_Y = 40
const DOT_R = 7
const CHORD_PROXIMITY_X = 20
const EPS = 0.001

const STAVE_TOP_Y = STAVE_Y + STAVE_TOP_OFFSET

// The rendered staff SVG is tall (lots of headroom); crop to a thin window centred
// on the staff lines so the scratch staff reads as a compact insert strip.
const WINDOW_H = 96
const CROP_TOP = 48

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

  const scratchMeasure: Measure = { id: 'scratch', number: 1, notes: scratch }

  useEffect(() => {
    if (!containerRef.current) return
    try {
      setLayout(renderStaff({ container: containerRef.current, measures: [scratchMeasure], timeSig, keySig, clef, staveY: STAVE_Y }))
    } catch (err) {
      console.error('Insert staff render failed', err)
    }
  }, [scratch, timeSig, keySig, clef])

  // Remove the last placed event on Backspace.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') { e.preventDefault(); setScratch(s => s.slice(0, -1)) }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

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
      const d = Math.abs(n.x - x)
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isRest) { setHoverInfo(null); return }
    const coords = getCoords(e)
    if (!coords) return
    const stepsDown = Math.round((coords.y - STAVE_TOP_Y) / (LINE_SPACING / 2))
    const snapY = staffStepToY(stepsDown, STAVE_Y)
    setHoverInfo({ x: coords.x, snapY, isChordTarget: !!nearestNoteAtX(coords.x) })
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getCoords(e)
    if (!coords) return

    // Chord-stack onto an existing scratch note (no extra duration).
    if (!isRest) {
      const near = nearestNoteAtX(coords.x)
      if (near) {
        const pitch = staffYToPitch(coords.y, STAVE_Y, clef)
        const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
        setScratch(s =>
          s.map(n => {
            if (n.id !== near.id || n.type !== 'note') return n
            const has = n.pitches.some(p => p.step === finalPitch.step && p.octave === finalPitch.octave && p.accidental === finalPitch.accidental)
            return has ? n : { ...n, pitches: sortPitches([...n.pitches, finalPitch]) }
          }),
        )
        return
      }
    }

    const candidate = { duration: selectedDuration, dots: isDotted ? 1 : 0 }
    if (beats + noteBeatDuration(candidate) > capacity + EPS) return  // would overflow the target measure

    if (isRest) {
      setScratch(s => [...s, { id: crypto.randomUUID(), type: 'rest', duration: selectedDuration, dots: isDotted ? 1 : 0 }])
    } else {
      const pitch = staffYToPitch(coords.y, STAVE_Y, clef)
      const finalPitch = selectedAccidental !== null ? { ...pitch, accidental: selectedAccidental } : pitch
      setScratch(s => [...s, { id: crypto.randomUUID(), type: 'note', pitches: [finalPitch], duration: selectedDuration, dots: isDotted ? 1 : 0, tied: false }])
    }
  }

  const accent = full ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)'
  const bg = full ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'

  return (
    <div
      className="absolute flex items-center gap-1.5"
      style={{ left, top, zIndex: 40 }}
      // Keep clicks inside the overlay from falling through to the staff beneath.
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        className="rounded-md overflow-hidden shadow-lg cursor-crosshair"
        style={{ border: `2px solid ${accent}`, background: bg, height: WINDOW_H }}
      >
        <div
          className="relative inline-block"
          style={{ transform: `translateY(${-CROP_TOP}px)` }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
        >
          <div ref={containerRef} />
          {hoverInfo && !isRest && (
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
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          title="Insert"
          onClick={() => onCommit(scratch)}
          disabled={scratch.length === 0}
          className="h-7 w-7 grid place-items-center rounded-md border border-violet-500/30 bg-violet-500/15 text-violet-600 hover:bg-violet-500/25 disabled:opacity-30 transition-colors"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          title="Cancel"
          onClick={onCancel}
          className="h-7 w-7 grid place-items-center rounded-md border border-zinc-400/30 bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
