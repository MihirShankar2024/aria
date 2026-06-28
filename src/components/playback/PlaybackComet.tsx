import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { PlaybackStatus } from '../../types/audio'
import type { ScrollSync } from '../../hooks/useScrollSync'
import { GRAND_TREBLE_Y, GRAND_BASS_Y, STAFF_HEIGHT } from '../../lib/vexflow/renderer'
import { STAVE_TOP_OFFSET, LINE_SPACING } from '../../lib/vexflow/hitTest'

// A staff card's top padding (py-8). The vexflow SVG starts this far below the card top.
const CARD_PY = 32
// Span (top line → bottom line) of a 5-line stave, relative to the SVG top.
const STAFF_SPAN = 4 * LINE_SPACING
// The three faint ledger guide lines drawn above and below each stave (renderer lines
// -1..-3 and 5..7), so the tracking line is tall enough to reach them.
const GUIDE_EXT = 3 * LINE_SPACING
const staffTop = (staveTopY: number) => staveTopY + STAVE_TOP_OFFSET
const TREBLE_TOP = staffTop(GRAND_TREBLE_Y) // grand staff, treble
const BASS_TOP = staffTop(GRAND_BASS_Y)     // grand staff, bass
const SINGLE_TOP = staffTop(48)             // lone staff (StaffCanvas STAVE_Y = 48)

// Golden palette (RGB triplets so opacity can vary per layer). Tweak here to retune the theme.
const GOLD = '251,191,36'         // amber-400 — the core glow
const GOLD_BRIGHT = '253,230,138' // amber-200 — hot inner highlight

interface Props {
  status: PlaybackStatus
  getPlaybackVisual: () => { contentX: number; startX: number; pulse: number } | null
  scrollSync: ScrollSync
  mainRef: RefObject<HTMLElement | null>
}

// Build the DOM for one comet lane: an elapsed trail band, plus a glowing orb with a comet
// tail. Positions are driven imperatively in the rAF loop, so playback never re-renders React.
function createLane() {
  const trail = document.createElement('div')
  trail.style.cssText =
    'position:absolute;height:16px;border-radius:9999px;filter:blur(3px);will-change:left,width;' +
    `background:linear-gradient(to right, rgba(${GOLD},0) 0%, rgba(${GOLD},0.10) 55%, rgba(${GOLD},0.30) 100%);`

  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;'

  const tail = document.createElement('div')
  tail.style.cssText =
    'position:absolute;left:-92px;top:-4px;width:92px;height:8px;border-radius:9999px;filter:blur(2px);' +
    `background:linear-gradient(to right, rgba(${GOLD},0) 0%, rgba(${GOLD_BRIGHT},0.7) 100%);`

  const orb = document.createElement('div')
  orb.style.cssText =
    'position:absolute;left:-9px;top:-9px;width:18px;height:18px;border-radius:9999px;will-change:transform;' +
    `background:radial-gradient(circle, #fffef5 0%, rgba(${GOLD_BRIGHT},1) 32%, rgba(${GOLD},1) 66%, rgba(${GOLD},0) 72%);`

  wrap.appendChild(tail)
  wrap.appendChild(orb)
  return { trail, wrap, orb, tail }
}

// A thin vertical playhead line that sits inside one staff (top line → bottom line).
function createLine() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:absolute;width:2px;border-radius:9999px;transform:translateX(-1px);will-change:left,top,height;' +
    `background:linear-gradient(to bottom, rgba(${GOLD},0.25) 0%, rgba(${GOLD},0.75) 50%, rgba(${GOLD},0.25) 100%);`
  return el
}

/**
 * A golden orb with a comet tail that glides smoothly along the channels between staves
 * during playback, trailing a luminous wake back to the start to show how much has elapsed.
 * A thin vertical line tracks the same position inside each staff. Rendered as a fixed,
 * click-through overlay floating above every track.
 */
export function PlaybackComet({ status, getPlaybackVisual, scrollSync, mainRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || status === 'stopped') return

    const lanes: ReturnType<typeof createLane>[] = []
    const lines: HTMLDivElement[] = []
    let raf = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = getPlaybackVisual()
      const primary = scrollSync.getPrimaryScroll()
      const main = mainRef.current
      if (!v || !primary || !main) { root.style.opacity = '0'; return }

      const pRect = primary.getBoundingClientRect()
      const mRect = main.getBoundingClientRect()
      const screenX = pRect.left + v.contentX - primary.scrollLeft
      // Where the elapsed trail begins on screen, clamped into the card so the band never
      // spills left of the staff even after the music has scrolled far past the start.
      const startScreenX = Math.max(pRect.left, pRect.left + v.startX - primary.scrollLeft)
      if (screenX < pRect.left - 4 || screenX > pRect.right + 4) { root.style.opacity = '0'; return }

      // The comet rides the channels: inside each grand staff, plus the gutter between every
      // pair of vertically-stacked cards. The tracking lines sit inside each staff's lines.
      const cards = [...main.querySelectorAll<HTMLElement>('[data-staff-card]')]
      const rects = cards.map(c => ({ rect: c.getBoundingClientRect(), kind: c.dataset.staffCard }))
      const laneYs: number[] = []
      const lineSpans: { top: number; bottom: number }[] = []
      for (const { rect, kind } of rects) {
        const svgTop = rect.top + CARD_PY
        if (kind === 'grand') {
          // No comet through the grand-staff channel — just the vertical tracking lines.
          lineSpans.push({ top: svgTop + TREBLE_TOP - GUIDE_EXT, bottom: svgTop + TREBLE_TOP + STAFF_SPAN + GUIDE_EXT })
          lineSpans.push({ top: svgTop + BASS_TOP - GUIDE_EXT, bottom: svgTop + BASS_TOP + STAFF_SPAN + GUIDE_EXT })
        } else {
          lineSpans.push({ top: svgTop + SINGLE_TOP - GUIDE_EXT, bottom: svgTop + SINGLE_TOP + STAFF_SPAN + GUIDE_EXT })
        }
      }
      for (let i = 0; i < rects.length - 1; i++) {
        laneYs.push((rects[i].rect.bottom + rects[i + 1].rect.top) / 2)
      }
      // Single solo staff with no neighbour and no inner channel: ride just beneath it.
      if (laneYs.length === 0 && rects.length > 0) {
        laneYs.push(rects[0].rect.top + CARD_PY + SINGLE_TOP + STAFF_HEIGHT)
      }

      // Clip to the scrolling viewport so nothing bleeds over the toolbar.
      const visLanes = laneYs.filter(y => y >= mRect.top + 4 && y <= mRect.bottom - 4).sort((a, b) => a - b)
      const visLines = lineSpans
        .map(s => ({ top: Math.max(s.top, mRect.top + 4), bottom: Math.min(s.bottom, mRect.bottom - 4) }))
        .filter(s => s.bottom - s.top > 1)
      root.style.opacity = visLanes.length || visLines.length ? '1' : '0'

      // ── Comet lanes ──
      while (lanes.length < visLanes.length) {
        const l = createLane()
        lanes.push(l)
        root.appendChild(l.trail)
        root.appendChild(l.wrap)
      }
      lanes.forEach((l, i) => {
        const on = i < visLanes.length
        l.trail.style.display = on ? 'block' : 'none'
        l.wrap.style.display = on ? 'block' : 'none'
      })

      // Subtle throb: a small swell and a touch of extra glow on each note onset.
      const orbScale = 1 + 0.12 * v.pulse
      const glow = `0 0 ${6 + 7 * v.pulse}px ${2 + 3 * v.pulse}px rgba(${GOLD},${0.4 + 0.18 * v.pulse})`
      const trailW = Math.max(0, screenX - startScreenX)
      visLanes.forEach((y, i) => {
        const l = lanes[i]
        l.trail.style.left = `${startScreenX}px`
        l.trail.style.top = `${y - 8}px`
        l.trail.style.width = `${trailW}px`
        l.wrap.style.transform = `translate(${screenX}px, ${y}px)`
        l.orb.style.transform = `scale(${orbScale})`
        l.orb.style.boxShadow = glow
        l.tail.style.opacity = `${0.5 + 0.2 * v.pulse}`
      })

      // ── Vertical tracking lines inside each staff ──
      while (lines.length < visLines.length) { const el = createLine(); lines.push(el); root.appendChild(el) }
      lines.forEach((el, i) => {
        const on = i < visLines.length
        el.style.display = on ? 'block' : 'none'
        if (!on) return
        const s = visLines[i]
        el.style.left = `${screenX}px`
        el.style.top = `${s.top}px`
        el.style.height = `${s.bottom - s.top}px`
      })
    }

    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); root.replaceChildren() }
  }, [status, getPlaybackVisual, scrollSync, mainRef])

  return <div ref={rootRef} className="pointer-events-none fixed inset-0 z-40 opacity-0" aria-hidden />
}
