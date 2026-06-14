import { useState, useEffect } from 'react'
import { Undo2, Redo2 } from 'lucide-react'
import { useScore } from '../../hooks/useScore'
import { usePlayback } from '../../hooks/usePlayback'
import { Button } from '../ui/button'
import { StaffCanvas } from './StaffCanvas'
import { DurationToolbar } from './DurationToolbar'
import { PlaybackBar } from '../playback/PlaybackBar'
import type { Duration, Accidental } from '../../types/score'

export function ScoreEditor() {
  const { score, dispatch, undo, redo, canUndo, canRedo } = useScore()
  const { status, play, stop } = usePlayback()

  const [selectedDuration, setSelectedDuration] = useState<Duration>('quarter')
  const [isDotted, setIsDotted] = useState(false)
  const [isRest, setIsRest] = useState(false)
  const [selectedAccidental, setSelectedAccidental] = useState<Accidental>(null)
  const [isTieMode, setIsTieMode] = useState(false)
  const [isFillMode, setIsFillMode] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
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
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleNotePlaced = () => {
    setIsDotted(false)
    setSelectedAccidental(null)
  }

  // Tie and fill are mutually exclusive modes — enabling one clears the other.
  const enterTieMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsTieMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) setIsFillMode(false)
      return v
    })
  }
  const enterFillMode = (next: boolean | ((p: boolean) => boolean)) => {
    setIsFillMode(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      if (v) setIsTieMode(false)
      return v
    })
  }

  const handleTieComplete = () => setIsTieMode(false)    // one-shot
  const handleFillComplete = () => setIsFillMode(false)  // one-shot

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

      {/* Duration toolbar */}
      <div className="px-6 py-3 border-b border-white/10">
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
        />
      </div>

      {/* Staff area */}
      <main className="flex-1 px-6 py-8 space-y-8 overflow-y-auto">
        {score.parts.map((part) => (
          <div key={part.id}>
            <p className="text-[11px] text-white/35 mb-2 font-medium tracking-widest uppercase">
              {part.name}
            </p>
            <StaffCanvas
              partId={part.id}
              measures={part.measures}
              timeSig={score.globalTimeSig}
              keySig={score.globalKeySig}
              dispatch={dispatch}
              selectedDuration={selectedDuration}
              selectedAccidental={selectedAccidental}
              isDotted={isDotted}
              isRest={isRest}
              ties={part.ties ?? []}
              isTieMode={isTieMode}
              isFillMode={isFillMode}
              onNotePlaced={handleNotePlaced}
              onTieComplete={handleTieComplete}
              onFillComplete={handleFillComplete}
            />
          </div>
        ))}
      </main>

      {/* Playback bar */}
      <footer className="sticky bottom-0 px-6 py-4 border-t border-white/10 bg-black/30 backdrop-blur-sm">
        <PlaybackBar score={score} status={status} onPlay={play} onStop={stop} />
      </footer>
    </div>
  )
}
