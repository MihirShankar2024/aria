import { useState, useCallback } from 'react'
import type { Score } from '../types/score'
import type { PlaybackStatus } from '../types/audio'
import { buildAndPlayScore, stopPlayback } from '../lib/audio/playback'

export function usePlayback() {
  const [status, setStatus] = useState<PlaybackStatus>('stopped')

  const play = useCallback(async (score: Score) => {
    setStatus('playing')
    await buildAndPlayScore(score, () => setStatus('stopped'))
  }, [])

  const stop = useCallback(() => {
    stopPlayback()
    setStatus('stopped')
  }, [])

  const pause = useCallback(() => {
    // Tone.js Transport pause
    import('tone').then(({ getTransport }) => getTransport().pause())
    setStatus('paused')
  }, [])

  return { status, play, stop, pause }
}
