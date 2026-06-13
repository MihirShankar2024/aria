import { useEffect, useRef } from 'react'
import { renderStaff } from '../../lib/vexflow/renderer'
import type { Measure } from '../../types/score'

const DEMO_MEASURE: Measure = {
  id: 'smoke-1',
  number: 1,
  notes: [
    { id: 'n1', type: 'note', pitch: { step: 'C', octave: 4, accidental: null }, duration: 'quarter', dots: 0, tied: false },
    { id: 'n2', type: 'note', pitch: { step: 'E', octave: 4, accidental: null }, duration: 'quarter', dots: 0, tied: false },
    { id: 'n3', type: 'note', pitch: { step: 'G', octave: 4, accidental: null }, duration: 'quarter', dots: 0, tied: false },
    { id: 'n4', type: 'note', pitch: { step: 'C', octave: 5, accidental: null }, duration: 'quarter', dots: 0, tied: false },
  ],
}

export function StaffSmokeTest() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    try {
      renderStaff({
        container: containerRef.current,
        measures: [DEMO_MEASURE],
        timeSig: { beats: 4, beatType: 4 },
        keySig: { fifths: 0, mode: 'major' },
        width: 400,
      })
    } catch (err) {
      console.error('VexFlow render error:', err)
    }
  }, [])

  return (
    <div className="bg-white rounded-lg p-4 inline-block">
      <div ref={containerRef} />
      <p className="text-gray-500 text-xs mt-2">C–E–G–C in 4/4. If you see a staff with notes above, VexFlow is working.</p>
    </div>
  )
}
