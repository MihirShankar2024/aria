import { useEffect, useRef, useState } from 'react'

export interface TrailPoint { x: number; y: number; born: number }

// A group of in-place rests left behind after a delete-brush release, awaiting a
// "confirm collapse" (or clear). Highlighted red until resolved.
export interface PendingRest { partId: string; measureId: string; restIds: string[] }

const TRAIL_MS = 420
const MAX_POINTS = 24

/**
 * A fading cursor trail for the delete brush. Returns the live points (for
 * rendering) and a `push` to feed cursor positions while erasing. The rAF loop
 * runs only while `active`, ageing points out and clearing on deactivate.
 */
export function useDeleteTrail(active: boolean) {
  const pointsRef = useRef<TrailPoint[]>([])
  const [trail, setTrail] = useState<TrailPoint[]>([])

  const push = (x: number, y: number) => {
    pointsRef.current.push({ x, y, born: performance.now() })
    if (pointsRef.current.length > MAX_POINTS) pointsRef.current.shift()
  }

  useEffect(() => {
    if (!active) {
      pointsRef.current = []
      setTrail([])
      return
    }
    let raf = 0
    const loop = () => {
      const now = performance.now()
      pointsRef.current = pointsRef.current.filter(p => now - p.born < TRAIL_MS)
      setTrail([...pointsRef.current])
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return { trail, push }
}

export { TRAIL_MS }
