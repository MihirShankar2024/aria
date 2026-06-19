import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Undo2, Redo2, Minus, Plus } from 'lucide-react'
import { useScore } from '../../hooks/useScore'
import { usePlayback } from '../../hooks/usePlayback'
import { useScrollSync } from '../../hooks/useScrollSync'
import { usePlaybackScroll, scrollToStartIfNeeded } from '../../hooks/usePlaybackScroll'
import { Button } from '../ui/button'
import { StaffCanvas } from './StaffCanvas'
import { GrandStaffCanvas } from './GrandStaffCanvas'
import { DurationToolbar } from './DurationToolbar'
import { PartsSidebar } from './PartsSidebar'
import { AddInstrumentButton } from './AddInstrumentButton'
import { RemoveTrackDialog, AddMeasuresDialog } from './TrackDialogs'
import { PlaybackBar } from '../playback/PlaybackBar'
import { computeSystemStaveWidths } from '../../lib/vexflow/renderer'
import { normalizeMeasureRests } from '../../lib/rests'
import { effectiveTimeSigAt } from '../../lib/beats'
import { transposeChromatic } from '../../lib/transposition/transpose'
import { selectionByEvent, moveSelectedPitches, deleteSelectedPitches, parseSelKey } from './noteSelection'
import { setClipboard } from './clipboard'
import type { PendingRest } from './useDeleteTrail'
import type { Part, Duration, Accidental, NoteEvent, Tie, VoiceNumber } from '../../types/score'

const EMPTY_TIES: Tie[] = []

type PartGroup =
  | { type: 'single'; part: Part }
  | { type: 'grand'; treble: Part; bass: Part }

function groupParts(parts: Part[]): PartGroup[] {
  const rendered = new Set<string>()
  const groups: PartGroup[] = []
  for (const part of parts) {
    if (rendered.has(part.id)) continue
    if (part.grandStaffPartnerId) {
      const partner = parts.find(p => p.id === part.grandStaffPartnerId)
      if (partner) {
        rendered.add(part.id)
        rendered.add(partner.id)
        const treble = part.clef === 'treble' ? part : partner
        const bass   = part.clef === 'treble' ? partner : part
        groups.push({ type: 'grand', treble, bass })
        continue
      }
    }
    rendered.add(part.id)
    groups.push({ type: 'single', part })
  }
  return groups
}

export function ScoreEditor() {
  const { score, dispatch, undo, redo, canUndo, canRedo } = useScore()
  const { status, play, pause, reset } = usePlayback()

  const [selectedDuration, setSelectedDuration] = useState<Duration>('quarter')
  const [isDotted, setIsDotted] = useState(false)
  const [isRest, setIsRest] = useState(false)
  const [activeVoice, setActiveVoice] = useState<VoiceNumber>(1)
  const [selectedAccidental, setSelectedAccidental] = useState<Accidental>(null)
  const [isTieMode, setIsTieMode] = useState(false)
  const [isFillMode, setIsFillMode] = useState(false)
  const [isDeleteMode, setIsDeleteMode] = useState(false)
  const [isBroomMode, setIsBroomMode] = useState(false)
  const [isInsertMode, setIsInsertMode] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [isSharpshooterMode, setIsSharpshooterMode] = useState(false)
  // Polyrhythm entry: when armed, placed notes flow into a reserved tuplet of `tupletSpec`.
  // The ratio persists as the last-used so re-arming reuses it.
  const [tupletEntry, setTupletEntry] = useState(false)
  // `played` notes spanning `beats` quarter-note beats; the inner ratio/base unit is derived.
  const [tupletSpec, setTupletSpec] = useState<{ played: number; beats: number }>({ played: 3, beats: 1 })
  // Keyboard placement: after placing a note, advance the cursor to the next beat (true,
  // default) or stay on the note just placed (false).
  const [advanceOnPlace, setAdvanceOnPlace] = useState(false)
  // Notation display mode: when true, each part is shown in its written/transposed key
  // (concert pitch is still the stored source of truth). Session-only, defaults on.
  const [transposedView, setTransposedView] = useState(true)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  // Per-part playback volume (gain 0–1, default 1 = unity). A mixer setting, kept out of
  // score state so dragging a slider doesn't churn the undo history.
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  // Transient toast (e.g. "Copied"). `id` retriggers the fade-in on repeated copies.
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1600)
  }, [])
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast
  const [pendingRests, setPendingRests] = useState<PendingRest[] | null>(null)
  // Track-header dialogs: confirm before removing a track; prompt for measure count.
  const [removeTarget, setRemoveTarget] = useState<{ partId: string; name: string } | null>(null)
  const [addMeasuresOpen, setAddMeasuresOpen] = useState(false)
  const scrollSync = useScrollSync()
  const { reportLayout } = usePlaybackScroll({ scrollSync, score, status })

  const volumesRef = useRef(volumes)
  volumesRef.current = volumes

  const handlePlay = useCallback((sc: typeof score, selectedNoteIds?: Set<string>) => {
    if (status === 'stopped') scrollToStartIfNeeded(scrollSync)
    // Selection carries composite per-notehead keys; playback filters by event id, so
    // collapse to the set of selected event ids (partial chords play as the whole event).
    const eventIds = selectedNoteIds && selectedNoteIds.size > 0
      ? new Set([...selectedNoteIds].map(k => parseSelKey(k).id))
      : selectedNoteIds
    play(sc, eventIds, volumesRef.current)
  }, [status, play, scrollSync])

  // Accidentals are note-only — choosing one means the user intends a note, so drop
  // out of rest mode. (Dots stay valid for rests, so they don't toggle rest off.)
  const handleAccidentalChange = (a: Accidental) => {
    setSelectedAccidental(a)
    if (a !== null) setIsRest(false)
  }

  // Refs so the (rarely re-subscribed) keydown handler reads current values.
  const pendingRef = useRef<PendingRest[] | null>(null)
  pendingRef.current = pendingRests
  const scoreRef = useRef(score)
  scoreRef.current = score
  const isSelectModeRef = useRef(isSelectMode)
  isSelectModeRef.current = isSelectMode
  const selectedNoteIdsRef = useRef(selectedNoteIds)
  selectedNoteIdsRef.current = selectedNoteIds

  // Remove the red in-place rests and let following notes shift left.
  const collapsePending = () => {
    const pend = pendingRef.current
    if (!pend) return
    const sc = scoreRef.current
    const edits: { partId: string; measureId: string; notes: typeof sc.parts[0]['measures'][0]['notes'] }[] = []
    for (const { partId, measureId, restIds } of pend) {
      const part = sc.parts.find(p => p.id === partId)
      const mIdx = part?.measures.findIndex(m => m.id === measureId) ?? -1
      const measure = mIdx >= 0 ? part!.measures[mIdx] : undefined
      if (!part || !measure) continue
      const remove = new Set(restIds)
      const notes = normalizeMeasureRests(measure.notes.filter(n => !remove.has(n.id)), effectiveTimeSigAt(part.measures, mIdx, sc.globalTimeSig))
      edits.push({ partId, measureId, notes })
    }
    setPendingRests(null)
    if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
  }

  // The red "pending rests" state persists across multiple delete strokes and is
  // cleared only when the delete tool is toggled off (effect below) or collapsed.
  useEffect(() => {
    if (!isDeleteMode) setPendingRests(null)
  }, [isDeleteMode])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Undo / redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      // Copy selected noteheads to the shared clipboard. Paste (Cmd+V) is handled by the
      // staff canvas the cursor is in, since that's where the insertion point lives.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        const sel = selectedNoteIdsRef.current
        if (sel.size === 0) return
        e.preventDefault()
        const byEvent = selectionByEvent(sel)
        const events: NoteEvent[] = []
        for (const part of scoreRef.current.parts) {
          for (const measure of part.measures) {
            for (const ev of measure.notes) {
              const s = byEvent.get(ev.id)
              if (!s) continue
              // Whole rest, or a fully-selected note → copy as-is; a partially-selected
              // chord → copy only the selected pitches.
              if (ev.type === 'rest' || s === 'all') { events.push(ev); continue }
              const pitches = ev.pitches.filter((_, i) => s.has(i))
              if (pitches.length) events.push({ ...ev, pitches })
            }
          }
        }
        if (events.length) {
          setClipboard(events)
          const n = events.length
          showToastRef.current(`Copied ${n} ${n === 1 ? 'note' : 'notes'}`)
        }
        // Drop back to note-entry mode so the cursor (and its ghost-note preview) is live
        // and Cmd+V has somewhere to paste — otherwise paste looks broken in select mode.
        setIsSelectMode(false)
        setSelectedNoteIds(new Set())
        return
      }
      // Cut: copy selected notes to clipboard, delete them, then exit select mode.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        const sel = selectedNoteIdsRef.current
        if (sel.size === 0) return
        e.preventDefault()
        const byEvent = selectionByEvent(sel)
        const events: NoteEvent[] = []
        for (const part of scoreRef.current.parts) {
          for (const measure of part.measures) {
            for (const ev of measure.notes) {
              const s = byEvent.get(ev.id)
              if (!s) continue
              if (ev.type === 'rest' || s === 'all') { events.push(ev); continue }
              const pitches = ev.pitches.filter((_, i) => s.has(i))
              if (pitches.length) events.push({ ...ev, pitches })
            }
          }
        }
        if (events.length) {
          setClipboard(events)
          const n = events.length
          showToastRef.current(`Cut and copied ${n} ${n === 1 ? 'note' : 'notes'}`)
          // Delete the selected notes from the score.
          const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
          for (const part of scoreRef.current.parts) {
            for (let mIdx = 0; mIdx < part.measures.length; mIdx++) {
              const measure = part.measures[mIdx]
              if (!measure.notes.some(n => byEvent.has(n.id))) continue
              const notes = normalizeMeasureRests(deleteSelectedPitches(measure.notes, byEvent), effectiveTimeSigAt(part.measures, mIdx, scoreRef.current.globalTimeSig))
              edits.push({ partId: part.id, measureId: measure.id, notes })
            }
          }
          if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
        }
        setIsSelectMode(false)
        setSelectedNoteIds(new Set())
        return
      }
      if (e.metaKey || e.ctrlKey) return
      // Shift key alone toggles select mode (sticky).
      if (e.key === 'Shift') {
        e.preventDefault()
        setIsSelectMode(prev => {
          const v = !prev
          if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSharpshooterMode(false) }
          if (!v) setSelectedNoteIds(new Set())
          return v
        })
        return
      }
      // Tab toggles Sharpshooter mode. Shift+Tab keeps quick collapse for pending rests.
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          if (pendingRef.current) collapsePending()
          return
        }
        enterSharpshooterMode(prev => !prev)
        return
      }
      switch (e.key) {
        case 'w': setSelectedDuration('whole'); break
        case 'h': setSelectedDuration('half'); break
        case 'q': setSelectedDuration('quarter'); break
        case 'e': case '8': setSelectedDuration('eighth'); break
        case 'x': case '1': case '6': setSelectedDuration('sixteenth'); break
        case 'd': case '.': setIsDotted(prev => !prev); break
        case ' ':
          e.preventDefault()
          setIsRest(prev => !prev)
          break
        case 'f': setSelectedAccidental(prev => { const next = prev === 'flat' ? null : 'flat'; if (next) setIsRest(false); return next }); break
        case 's': setSelectedAccidental(prev => { const next = prev === 'sharp' ? null : 'sharp'; if (next) setIsRest(false); return next }); break
        case 'n': setSelectedAccidental(prev => { const next = prev === 'natural' ? null : 'natural'; if (next) setIsRest(false); return next }); break
        case 'v': setActiveVoice(prev => (prev === 1 ? 2 : 1)); break
        case 't': enterTieMode(prev => !prev); break
        case 'b': enterBroomMode(prev => !prev); break
        case 'i': enterInsertMode(prev => !prev); break
        case 'p': enterTupletEntry(prev => !prev); break
        case 'ArrowUp':
        case 'ArrowDown': {
          // In select mode, arrows nudge the selected notes chromatically
          // (±1 half step, Shift = ±1 octave). Otherwise leave arrows to the
          // staff's keyboard cursor.
          if (!isSelectModeRef.current || selectedNoteIdsRef.current.size === 0) break
          e.preventDefault()
          const semis = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)
          const sc = scoreRef.current
          const byEvent = selectionByEvent(selectedNoteIdsRef.current)
          const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
          const newKeys: string[] = []
          for (const part of sc.parts) {
            for (const measure of part.measures) {
              if (!measure.notes.some(n => byEvent.has(n.id))) continue
              const res = moveSelectedPitches(measure.notes, byEvent, p => transposeChromatic(p, semis))
              edits.push({ partId: part.id, measureId: measure.id, notes: res.notes })
              newKeys.push(...res.newKeys)
            }
          }
          if (edits.length) {
            dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
            setSelectedNoteIds(new Set(newKeys))  // re-key after sort so heads stay selected
          }
          break
        }
        case 'Escape':
          if (isSelectModeRef.current) {
            if (selectedNoteIdsRef.current.size > 0) setSelectedNoteIds(new Set())
            else enterSelectMode(false)
          } else {
            // Exit any active tool mode (tie / fill / delete / broom / insert / sharpshooter).
            setIsTieMode(false)
            setIsFillMode(false)
            setIsDeleteMode(false)
            setIsBroomMode(false)
            setIsInsertMode(false)
            setIsSharpshooterMode(false)
          }
          break
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          if (isSelectModeRef.current && selectedNoteIdsRef.current.size > 0) {
            // Delete using current score ref to avoid stale closure
            const sc = scoreRef.current
            const byEvent = selectionByEvent(selectedNoteIdsRef.current)
            const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
            for (const part of sc.parts) {
              for (let mIdx = 0; mIdx < part.measures.length; mIdx++) {
                const measure = part.measures[mIdx]
                if (!measure.notes.some(n => byEvent.has(n.id))) continue
                // Remove selected noteheads (emptied chords drop out), then shift the rest
                // left (no in-place rests), like collapsePending.
                const notes = normalizeMeasureRests(deleteSelectedPitches(measure.notes, byEvent), effectiveTimeSigAt(part.measures, mIdx, sc.globalTimeSig))
                edits.push({ partId: part.id, measureId: measure.id, notes })
              }
            }
            if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
            setSelectedNoteIds(new Set())
            break
          }
          enterDeleteMode(prev => !prev)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  const handleNotePlaced = () => {
    setIsDotted(false)
    setSelectedAccidental(null)
  }

  const enterTieMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsTieMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterFillMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsFillMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterDeleteMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsDeleteMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterBroomMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsBroomMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsInsertMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterInsertMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsInsertMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterSelectMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsSelectMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSharpshooterMode(false); setTupletEntry(false) }
      if (!v) setSelectedNoteIds(new Set())
      return v
    })
  }
  const enterSharpshooterMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsSharpshooterMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSelectMode(false); setTupletEntry(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  // Arming polyrhythm entry clears the exclusive tool modes so placement resumes.
  const enterTupletEntry = (next: boolean | ((p: boolean) => boolean)) => {
    setTupletEntry(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsBroomMode(false); setIsInsertMode(false); setIsSelectMode(false); setIsSharpshooterMode(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const deleteSelectedNotes = () => {
    if (selectedNoteIds.size === 0) return
    const byEvent = selectionByEvent(selectedNoteIds)
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    for (const part of score.parts) {
      for (let mIdx = 0; mIdx < part.measures.length; mIdx++) {
        const measure = part.measures[mIdx]
        if (!measure.notes.some(n => byEvent.has(n.id))) continue
        // Remove selected noteheads (emptied chords drop out) and shift the rest left.
        const notes = normalizeMeasureRests(deleteSelectedPitches(measure.notes, byEvent), effectiveTimeSigAt(part.measures, mIdx, score.globalTimeSig))
        edits.push({ partId: part.id, measureId: measure.id, notes })
      }
    }
    if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
    setSelectedNoteIds(new Set())
  }

  // Group the selected events into a tuplet. Requires ≥2 events within a single measure;
  // the reducer enforces same-voice + contiguity and silently no-ops otherwise.
  const makeSelectedTuplet = (played: number, inSpaceOf: number) => {
    const ids = new Set(selectionByEvent(selectedNoteIds).keys())
    if (ids.size < 2) return
    for (const part of score.parts) {
      for (const measure of part.measures) {
        const inMeasure = measure.notes.filter(n => ids.has(n.id))
        if (inMeasure.length === 0) continue
        if (inMeasure.length !== ids.size) return // selection spans measures — bail
        dispatch({ type: 'CREATE_TUPLET', partId: part.id, measureId: measure.id, memberIds: inMeasure.map(n => n.id), played, inSpaceOf })
        setSelectedNoteIds(new Set())
        return
      }
    }
  }

  const handleTieComplete = () => setIsTieMode(false)
  const handleFillComplete = () => setIsFillMode(false)
  const handleInsertComplete = () => setIsInsertMode(false)

  // Accumulate pending red rests across strokes; a re-touched measure's entry is
  // replaced (its rests were re-IDed), other measures are kept.
  const handleRestsCommitted = (pending: PendingRest[]) => {
    setPendingRests(prev => {
      const byKey = new Map<string, PendingRest>()
      for (const p of prev ?? []) byKey.set(`${p.partId}|${p.measureId}`, p)
      for (const p of pending) byKey.set(`${p.partId}|${p.measureId}`, p)
      const arr = [...byKey.values()].filter(p => p.restIds.length > 0)
      return arr.length ? arr : null
    })
  }

  const pendingRestIdSet = useMemo(
    () => new Set(pendingRests?.flatMap(p => p.restIds) ?? []),
    [pendingRests],
  )

  const groups = groupParts(score.parts)
  const measureCount = Math.max(1, ...score.parts.map(p => p.measures.length))

  // One shared stave-width per measure index across all parts, so barlines align
  // vertically across every staff (standard system engraving).
  const systemStaveWidths = useMemo(
    () => computeSystemStaveWidths(score.parts, score.globalTimeSig, score.globalKeySig),
    [score.parts, score.globalTimeSig, score.globalKeySig],
  )

  const commonCanvasProps = {
    dispatch,
    selectedDuration,
    selectedAccidental,
    isDotted,
    isRest,
    activeVoice,
    isTieMode,
    isFillMode,
    isDeleteMode,
    isBroomMode,
    isInsertMode,
    isSelectMode,
    isSharpshooterMode,
    tupletEntry,
    tupletSpec,
    advanceOnPlace,
    transposedView,
    selectedNoteIds,
    onSelectionChange: setSelectedNoteIds,
    initialTempo: score.tempo,
    tempoChanges: score.tempoChanges,
    forcedStaveWidths: systemStaveWidths.length ? systemStaveWidths : undefined,
    scrollSync,
    pendingRestIds: pendingRestIdSet,
    onNotePlaced: handleNotePlaced,
    onTieComplete: handleTieComplete,
    onFillComplete: handleFillComplete,
    onInsertComplete: handleInsertComplete,
    onPlaceFailed: () => showToastRef.current('Doesn\'t fit in measure'),
    onRestsCommitted: handleRestsCommitted,
  }

  return (
    <div className="relative min-h-screen text-white flex flex-col">
      {/* Transient toast (copy confirmation, etc.) — floats at the top, fades in. */}
      {toast && (
        <div
          key={toast.id}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="rounded-full bg-white/10 border border-white/15 px-4 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md shadow-lg">
            {toast.msg}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <h1 className="text-xl font-semibold tracking-tight"></h1>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={undo}
            disabled={!canUndo}
            title="Undo"
            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-25"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={redo}
            disabled={!canRedo}
            title="Redo"
            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-25"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Toolbar — floats at the top of the viewport over the score while scrolling. */}
      <div className="sticky top-0 z-30 px-6 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <DurationToolbar
          selectedDuration={selectedDuration}
          onDurationChange={setSelectedDuration}
          isDotted={isDotted}
          onDottedChange={setIsDotted}
          isRest={isRest}
          onRestChange={setIsRest}
          tupletEntry={tupletEntry}
          onTupletEntryChange={enterTupletEntry}
          tupletSpec={tupletSpec}
          onTupletSpecChange={setTupletSpec}
          activeVoice={activeVoice}
          onActiveVoiceChange={setActiveVoice}
          selectedAccidental={selectedAccidental}
          onAccidentalChange={handleAccidentalChange}
          isTieMode={isTieMode}
          onTieModeChange={enterTieMode}
          isFillMode={isFillMode}
          onFillModeChange={enterFillMode}
          isDeleteMode={isDeleteMode}
          onDeleteModeChange={enterDeleteMode}
          isBroomMode={isBroomMode}
          onBroomModeChange={enterBroomMode}
          isInsertMode={isInsertMode}
          onInsertModeChange={enterInsertMode}
          isSelectMode={isSelectMode}
          onSelectModeChange={enterSelectMode}
          isSharpshooterMode={isSharpshooterMode}
          onSharpshooterModeChange={enterSharpshooterMode}
          advanceOnPlace={advanceOnPlace}
          onAdvanceOnPlaceChange={setAdvanceOnPlace}
          transposedView={transposedView}
          onTransposedViewChange={setTransposedView}
          selectedNoteCount={selectedNoteIds.size}
          onDeleteSelected={deleteSelectedNotes}
          onMakeTuplet={makeSelectedTuplet}
          hasPendingRests={!!pendingRests}
          onCollapseRests={collapsePending}
          globalTimeSig={score.globalTimeSig}
          globalKeySig={score.globalKeySig}
          initialTempo={score.tempo}
          measureCount={measureCount}
          dispatch={dispatch}
        />
      </div>

      {/* Body: sidebar + score */}
      <div className="flex flex-1 overflow-hidden">
        <PartsSidebar
          parts={score.parts}
          dispatch={dispatch}
          volumes={volumes}
          onVolumeChange={(partIds, v) => setVolumes(prev => {
            const next = { ...prev }
            for (const id of partIds) next[id] = v
            return next
          })}
        />

        <main className="flex-1 px-6 py-8 space-y-8 overflow-y-auto">
          {groups.map((group, groupIdx) => {
            const playbackLayoutProps = groupIdx === 0
              ? { onPlaybackLayoutChange: reportLayout }
              : {}
            if (group.type === 'grand') {
              return (
                <div key={group.treble.id}>
                  <TrackHeader
                    name="Piano"
                    canRemove={groups.length > 1}
                    onRemove={() => setRemoveTarget({ partId: group.treble.id, name: 'Piano' })}
                    onAddMeasures={() => setAddMeasuresOpen(true)}
                  />
                  <GrandStaffCanvas
                    treblePart={group.treble}
                    bassPart={group.bass}
                    timeSig={score.globalTimeSig}
                    keySig={score.globalKeySig}
                    {...playbackLayoutProps}
                    {...commonCanvasProps}
                  />
                </div>
              )
            }
            const { part } = group
            return (
              <div key={part.id}>
                <TrackHeader
                  name={part.name}
                  canRemove={groups.length > 1}
                  onRemove={() => setRemoveTarget({ partId: part.id, name: part.name })}
                  onAddMeasures={() => setAddMeasuresOpen(true)}
                />
                <StaffCanvas
                  partId={part.id}
                  instrument={part.instrument}
                  measures={part.measures}
                  timeSig={score.globalTimeSig}
                  keySig={score.globalKeySig}
                  clef={part.clef}
                  ties={part.ties ?? EMPTY_TIES}
                  {...playbackLayoutProps}
                  {...commonCanvasProps}
                />
              </div>
            )
          })}
        </main>
      </div>

      {/* Playback bar + add instrument, grouped to fit within the left column width */}
      <footer className="sticky bottom-0 px-6 py-4 border-t border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="w-fit flex items-center gap-2">
          <PlaybackBar
            score={score}
            status={status}
            onPlay={handlePlay}
            onStop={pause}
            onReset={() => { reset(); scrollSync.scrollAllTo(0, true) }}
            selectedNoteIds={selectedNoteIds.size > 0 ? selectedNoteIds : undefined}
          />
          <AddInstrumentButton dispatch={dispatch} />
        </div>
      </footer>

      <RemoveTrackDialog
        trackName={removeTarget?.name ?? null}
        open={removeTarget !== null}
        onOpenChange={open => { if (!open) setRemoveTarget(null) }}
        onConfirm={() => { if (removeTarget) dispatch({ type: 'REMOVE_PART', partId: removeTarget.partId }) }}
      />
      <AddMeasuresDialog
        open={addMeasuresOpen}
        onOpenChange={setAddMeasuresOpen}
        onConfirm={count => dispatch({ type: 'ADD_MEASURES', count })}
      />
    </div>
  )
}

function TrackHeader({
  name,
  canRemove,
  onRemove,
  onAddMeasures,
}: {
  name: string
  canRemove: boolean
  onRemove: () => void
  onAddMeasures: () => void
}) {
  return (
    <div className="flex items-center gap-2 mb-2 group">
      <p className="text-[11px] text-white/35 font-medium tracking-widest uppercase">{name}</p>
      {canRemove && (
        <button
          onClick={onRemove}
          title="Remove instrument"
          className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-4 w-4 rounded-full border border-white/20 text-white/40 hover:text-red-400 hover:border-red-400/60 transition"
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={onAddMeasures}
        title="Add measures"
        className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/55 hover:border-white/30 hover:bg-white/10 hover:text-white transition"
      >
        <Plus className="h-3 w-3" />
        Measures
      </button>
    </div>
  )
}
