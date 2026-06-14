import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Undo2, Redo2 } from 'lucide-react'
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
import { PlaybackBar } from '../playback/PlaybackBar'
import { computeSystemStaveWidths } from '../../lib/vexflow/renderer'
import { normalizeMeasureRests } from '../../lib/rests'
import type { PendingRest } from './useDeleteTrail'
import type { Part, Duration, Accidental, NoteEvent, Tie } from '../../types/score'

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
  const [selectedAccidental, setSelectedAccidental] = useState<Accidental>(null)
  const [isTieMode, setIsTieMode] = useState(false)
  const [isFillMode, setIsFillMode] = useState(false)
  const [isDeleteMode, setIsDeleteMode] = useState(false)
  const [isInsertMode, setIsInsertMode] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [pendingRests, setPendingRests] = useState<PendingRest[] | null>(null)
  const scrollSync = useScrollSync()
  const { reportLayout } = usePlaybackScroll({ scrollSync, score, status })

  const handlePlay = useCallback((sc: typeof score, selectedNoteIds?: Set<string>) => {
    if (status === 'stopped') scrollToStartIfNeeded(scrollSync)
    play(sc, selectedNoteIds)
  }, [status, play, scrollSync])

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
      const measure = sc.parts.find(p => p.id === partId)?.measures.find(m => m.id === measureId)
      if (!measure) continue
      const remove = new Set(restIds)
      const notes = normalizeMeasureRests(measure.notes.filter(n => !remove.has(n.id)), measure.timeSig ?? sc.globalTimeSig)
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
      if (e.metaKey || e.ctrlKey) return
      // Shift key alone toggles select mode (sticky).
      if (e.key === 'Shift') {
        e.preventDefault()
        setIsSelectMode(prev => {
          const v = !prev
          if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsInsertMode(false) }
          if (!v) setSelectedNoteIds(new Set())
          return v
        })
        return
      }
      // Tab confirm-collapses the pending red rests left behind by deletes.
      if (e.key === 'Tab') {
        e.preventDefault()
        if (pendingRef.current) collapsePending()
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
        case 'f': setSelectedAccidental(prev => prev === 'flat' ? null : 'flat'); break
        case 's': setSelectedAccidental(prev => prev === 'sharp' ? null : 'sharp'); break
        case 'n': setSelectedAccidental(prev => prev === 'natural' ? null : 'natural'); break
        case 't': enterTieMode(prev => !prev); break
        case 'i': enterInsertMode(prev => !prev); break
        case 'Escape':
          if (isSelectModeRef.current) {
            if (selectedNoteIdsRef.current.size > 0) setSelectedNoteIds(new Set())
            else enterSelectMode(false)
          } else {
            // Exit any active tool mode (tie / fill / delete / insert).
            setIsTieMode(false)
            setIsFillMode(false)
            setIsDeleteMode(false)
            setIsInsertMode(false)
          }
          break
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          if (isSelectModeRef.current && selectedNoteIdsRef.current.size > 0) {
            // Delete using current score ref to avoid stale closure
            const sc = scoreRef.current
            const ids = selectedNoteIdsRef.current
            const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
            for (const part of sc.parts) {
              for (const measure of part.measures) {
                if (!measure.notes.some(n => ids.has(n.id))) continue
                // Remove selected notes entirely and shift the rest left
                // (no in-place rests), like collapsePending.
                const notes = normalizeMeasureRests(measure.notes.filter(n => !ids.has(n.id)), measure.timeSig ?? sc.globalTimeSig)
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
      if (v) { setIsFillMode(false); setIsDeleteMode(false); setIsInsertMode(false); setIsSelectMode(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterFillMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsFillMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsDeleteMode(false); setIsInsertMode(false); setIsSelectMode(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterDeleteMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsDeleteMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsInsertMode(false); setIsSelectMode(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterInsertMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsInsertMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsSelectMode(false); setSelectedNoteIds(new Set()) }
      return v
    })
  }
  const enterSelectMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsSelectMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) { setIsTieMode(false); setIsFillMode(false); setIsDeleteMode(false); setIsInsertMode(false) }
      if (!v) setSelectedNoteIds(new Set())
      return v
    })
  }
  const deleteSelectedNotes = () => {
    if (selectedNoteIds.size === 0) return
    const edits: { partId: string; measureId: string; notes: NoteEvent[] }[] = []
    for (const part of score.parts) {
      for (const measure of part.measures) {
        if (!measure.notes.some(n => selectedNoteIds.has(n.id))) continue
        // Remove selected notes entirely and shift the rest left (no in-place rests).
        const notes = normalizeMeasureRests(measure.notes.filter(n => !selectedNoteIds.has(n.id)), measure.timeSig ?? score.globalTimeSig)
        edits.push({ partId: part.id, measureId: measure.id, notes })
      }
    }
    if (edits.length) dispatch({ type: 'APPLY_MEASURE_NOTES', edits })
    setSelectedNoteIds(new Set())
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
    isTieMode,
    isFillMode,
    isDeleteMode,
    isInsertMode,
    isSelectMode,
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
    onRestsCommitted: handleRestsCommitted,
  }

  return (
    <div className="relative min-h-screen text-white flex flex-col">
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
          selectedAccidental={selectedAccidental}
          onAccidentalChange={setSelectedAccidental}
          isTieMode={isTieMode}
          onTieModeChange={enterTieMode}
          isFillMode={isFillMode}
          onFillModeChange={enterFillMode}
          isDeleteMode={isDeleteMode}
          onDeleteModeChange={enterDeleteMode}
          isInsertMode={isInsertMode}
          onInsertModeChange={enterInsertMode}
          isSelectMode={isSelectMode}
          onSelectModeChange={enterSelectMode}
          selectedNoteCount={selectedNoteIds.size}
          onDeleteSelected={deleteSelectedNotes}
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
        <PartsSidebar parts={score.parts} dispatch={dispatch} />

        <main className="flex-1 px-6 py-8 space-y-8 overflow-y-auto">
          {groups.map((group, groupIdx) => {
            const playbackLayoutProps = groupIdx === 0
              ? { onPlaybackLayoutChange: reportLayout }
              : {}
            if (group.type === 'grand') {
              return (
                <div key={group.treble.id}>
                  <p className="text-[11px] text-white/35 mb-2 font-medium tracking-widest uppercase">
                    Piano
                  </p>
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
                <p className="text-[11px] text-white/35 mb-2 font-medium tracking-widest uppercase">
                  {part.name}
                </p>
                <StaffCanvas
                  partId={part.id}
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
    </div>
  )
}
