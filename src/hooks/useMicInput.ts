import { useState, useRef, useCallback } from 'react'
import type { PitchEvent } from '../types/audio'

type MicStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error'

export function useMicInput() {
  const [status, setStatus] = useState<MicStatus>('idle')
  const [pitchEvents, setPitchEvents] = useState<PitchEvent[]>([])
  const workerRef = useRef<Worker | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    try {
      setStatus('recording')
      chunksRef.current = []
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        setStatus('processing')
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const audioCtx = new AudioContext({ sampleRate: 22050 })
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
        const float32 = audioBuffer.getChannelData(0)

        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/basicPitch.worker.ts', import.meta.url),
            { type: 'module' },
          )
        }

        workerRef.current.onmessage = (e: MessageEvent<PitchEvent[]>) => {
          setPitchEvents(e.data)
          setStatus('done')
        }
        workerRef.current.onerror = () => setStatus('error')
        workerRef.current.postMessage(float32, [float32.buffer])
      }

      recorder.start()
    } catch {
      setStatus('error')
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  const clearEvents = useCallback(() => {
    setPitchEvents([])
    setStatus('idle')
  }, [])

  return { status, pitchEvents, startRecording, stopRecording, clearEvents }
}
