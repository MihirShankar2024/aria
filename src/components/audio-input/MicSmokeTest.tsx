import { useState } from 'react'
import { useMicInput } from '../../hooks/useMicInput'

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
        <button
          onClick={handleToggle}
          disabled={status === 'processing'}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-opacity disabled:opacity-50 ${
            recording
              ? 'bg-destructive text-destructive-foreground hover:opacity-90'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
        >
          {recording ? 'Stop recording' : status === 'processing' ? 'Processing...' : 'Start recording'}
        </button>
        <span className="text-xs text-muted-foreground">
          Status: <span className="text-foreground">{status}</span>
        </span>
      </div>

      {status === 'processing' && (
        <p className="text-xs text-accent-foreground">Running Basic Pitch WASM model... (may take a few seconds)</p>
      )}

      {pitchEvents.length > 0 && (
        <div>
          <p className="text-xs text-primary mb-2">Detected {pitchEvents.length} pitch events:</p>
          <ul className="font-mono text-xs text-muted-foreground space-y-1 bg-muted rounded-md p-3 max-h-48 overflow-y-auto">
            {pitchEvents.slice(0, 20).map((e, i) => (
              <li key={i}>
                MIDI {e.midiNote} | {e.startTime.toFixed(2)}s–{e.endTime.toFixed(2)}s | amp {e.amplitude.toFixed(2)}
              </li>
            ))}
            {pitchEvents.length > 20 && <li className="text-muted-foreground/60">...and {pitchEvents.length - 20} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
