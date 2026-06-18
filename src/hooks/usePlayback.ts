import { useState, useCallback, useRef } from 'react'
import type { Score } from '../types/score'
import type { PlaybackStatus } from '../types/audio'
import { buildAndPlayScore, pausePlayback, resumePlayback, stopPlayback } from '../lib/audio/playback'

export function usePlayback() {
  const [status, setStatus] = useState<PlaybackStatus>('stopped')
  // Mirror of status so the memoized callbacks read the current value without
  // re-subscribing on every change.
  const statusRef = useRef<PlaybackStatus>('stopped')
  const set = useCallback((s: PlaybackStatus) => { statusRef.current = s; setStatus(s) }, [])

  // Start from the beginning, or resume from a paused playhead.
  const play = useCallback(async (score: Score, selectedNoteIds?: Set<string>, partVolumes?: Record<string, number>) => {
    if (statusRef.current === 'playing') return
    if (statusRef.current === 'paused') {
      resumePlayback()
      set('playing')
      return
    }
    set('playing')
    await buildAndPlayScore(score, () => set('stopped'), selectedNoteIds, partVolumes)
  }, [set])

  // Halt playback but keep the playhead so play() resumes from here.
  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return
    pausePlayback()
    set('paused')
  }, [set])

  // Rewind to the beginning and clear the playhead.
  const reset = useCallback(() => {
    stopPlayback()
    set('stopped')
  }, [set])

  return { status, play, pause, reset }
}
