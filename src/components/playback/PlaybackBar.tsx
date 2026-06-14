import { Play, Square } from 'lucide-react'
import { Button } from '../ui/button'
import type { Score } from '../../types/score'
import type { PlaybackStatus } from '../../types/audio'

interface PlaybackBarProps {
  score: Score
  status: PlaybackStatus
  onPlay: (score: Score) => void
  onStop: () => void
}

export function PlaybackBar({ score, status, onPlay, onStop }: PlaybackBarProps) {
  const isPlaying = status === 'playing'

  return (
    <div className="inline-flex items-center gap-3 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
      <Button
        variant="ghost"
        size="icon"
        onClick={isPlaying ? onStop : () => onPlay(score)}
        className="h-8 w-8 text-white hover:bg-white/10"
        title={isPlaying ? 'Stop' : 'Play'}
      >
        {isPlaying ? (
          <Square className="h-3.5 w-3.5 fill-white stroke-white" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-white stroke-white" />
        )}
      </Button>
    </div>
  )
}
