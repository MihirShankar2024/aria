import { Play, Square, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import type { Score } from '../../types/score'
import type { PlaybackStatus } from '../../types/audio'

interface PlaybackBarProps {
  score: Score
  status: PlaybackStatus
  onPlay: (score: Score, selectedNoteIds?: Set<string>) => void
  onStop: () => void
  onReset: () => void
  selectedNoteIds?: Set<string>
}

export function PlaybackBar({ score, status, onPlay, onStop, onReset, selectedNoteIds }: PlaybackBarProps) {
  const isPlaying = status === 'playing'
  const btn = 'h-8 w-8 text-white hover:bg-white/10 disabled:opacity-30'

  return (
    <div className="inline-flex items-center gap-1 px-2 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
      {/* Play / resume — disabled while already playing. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onPlay(score, selectedNoteIds)}
        disabled={isPlaying}
        className={btn}
        title={status === 'paused' ? 'Resume' : 'Play'}
      >
        <Play className="h-3.5 w-3.5 fill-white stroke-white" />
      </Button>

      {/* Stop — pauses and keeps the playhead so Play resumes from here. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onStop}
        disabled={!isPlaying}
        className={btn}
        title="Stop"
      >
        <Square className="h-3.5 w-3.5 fill-white stroke-white" />
      </Button>

      {/* Reset — rewind to the beginning and scroll back to the start. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onReset}
        disabled={status === 'stopped'}
        className={btn}
        title="Back to start"
      >
        <RotateCcw className="h-3.5 w-3.5 stroke-white" />
      </Button>
    </div>
  )
}
