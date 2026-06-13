import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMicInput } from '@/hooks/useMicInput'

export function MicSmokeTest() {
  const { status, pitchEvents, startRecording, stopRecording, clearEvents } = useMicInput()
  const [recording, setRecording] = useState(false)

  async function handleToggle() {
    if (recording) {
      stopRecording()
      setRecording(false)
    } else {
      clearEvents()
      await startRecording()
      setRecording(true)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          onClick={handleToggle}
          disabled={status === 'processing'}
          variant={recording ? 'destructive' : 'default'}
        >
          {recording ? 'Stop recording' : status === 'processing' ? 'Processing...' : 'Start recording'}
        </Button>
        <span className="text-xs text-white/50">
          Status: <span className="text-white/80">{status}</span>
        </span>
      </div>

      {status === 'processing' && (
        <p className="text-xs text-accent-foreground">Running Basic Pitch WASM model...</p>
      )}

      {pitchEvents.length > 0 && (
        <div>
          <p className="text-xs text-primary mb-2">Detected {pitchEvents.length} pitch events:</p>
          <ul className="font-mono text-xs text-white/50 space-y-1 bg-white/5 rounded-md p-3 max-h-48 overflow-y-auto">
            {pitchEvents.slice(0, 20).map((e, i) => (
              <li key={i}>
                MIDI {e.midiNote} | {e.startTime.toFixed(2)}s–{e.endTime.toFixed(2)}s | amp {e.amplitude.toFixed(2)}
              </li>
            ))}
            {pitchEvents.length > 20 && <li className="text-white/30">...and {pitchEvents.length - 20} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
