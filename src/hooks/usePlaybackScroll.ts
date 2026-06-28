import { useCallback, useEffect, useRef } from 'react'
import * as Tone from 'tone'
import type { Score } from '../types/score'
import type { PlaybackStatus } from '../types/audio'
import type { ScrollSync } from './useScrollSync'
import { buildPlaybackTimeline, xAtTime, xAtTimeSmooth, type PlaybackLayout } from '../lib/playback/timeline'

export type { PlaybackLayout }

const CARD_PAD = 16
const RIGHT_MARGIN = 48
const SCROLL_COOLDOWN_MS = 500

interface UsePlaybackScrollOptions {
  scrollSync: ScrollSync
  score: Score
  status: PlaybackStatus
}

/** Smoothly scroll staves during playback so the playhead stays in view. */
export function usePlaybackScroll({ scrollSync, score, status }: UsePlaybackScrollOptions) {
  const layoutRef = useRef<PlaybackLayout | null>(null)
  const timelineRef = useRef<ReturnType<typeof buildPlaybackTimeline>>([{ time: 0, x: 0 }])
  const suppressScrollUntil = useRef(0)

  const reportLayout = useCallback((layout: PlaybackLayout) => {
    const prev = layoutRef.current
    if (prev?.measures === layout.measures && prev?.notes === layout.notes) return
    layoutRef.current = layout
    timelineRef.current = buildPlaybackTimeline(score, layout)
  }, [score])

  useEffect(() => {
    if (layoutRef.current) {
      timelineRef.current = buildPlaybackTimeline(score, layoutRef.current)
    }
  }, [score])

  // Per-frame playhead readout for visual overlays (the comet). Returns the playhead's
  // x in card-content coordinates (same space as the scroll math below) plus a 0–1
  // `pulse` that spikes to 1 on each note onset and decays, so the orb can throb in time.
  const getPlaybackVisual = useCallback((): { contentX: number; startX: number; pulse: number } | null => {
    if (!layoutRef.current) return null
    const t = Tone.getTransport().seconds
    const points = timelineRef.current
    let lastOnset = 0
    for (const p of points) {
      if (p.time > t) break
      lastOnset = p.time
    }
    return {
      contentX: CARD_PAD + xAtTimeSmooth(points, t),
      startX: CARD_PAD + (points[0]?.x ?? 0),
      pulse: Math.exp(-(t - lastOnset) / 0.12),
    }
  }, [])

  useEffect(() => {
    if (status !== 'playing') return

    let raf = 0
    const tick = () => {
      const sc = scrollSync.getPrimaryScroll()
      const layout = layoutRef.current
      if (sc && layout && sc.scrollWidth > sc.clientWidth) {
        if (performance.now() >= suppressScrollUntil.current) {
          const t = Tone.getTransport().seconds
          const playheadX = CARD_PAD + xAtTime(timelineRef.current, t)
          const viewRight = sc.scrollLeft + sc.clientWidth

          if (playheadX > viewRight - RIGHT_MARGIN) {
            const target = Math.max(0, Math.min(playheadX - CARD_PAD, sc.scrollWidth - sc.clientWidth))
            scrollSync.scrollAllTo(target, true)
            suppressScrollUntil.current = performance.now() + SCROLL_COOLDOWN_MS
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status, scrollSync, score])

  return { reportLayout, getPlaybackVisual }
}

/** Scroll back to the start when beginning a fresh play from a scrolled-away view. */
export function scrollToStartIfNeeded(scrollSync: ScrollSync): void {
  const sc = scrollSync.getPrimaryScroll()
  if (sc && sc.scrollLeft > 1) scrollSync.scrollAllTo(0, true)
}
