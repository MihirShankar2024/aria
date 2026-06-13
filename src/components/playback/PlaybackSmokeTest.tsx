import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function PlaybackSmokeTest() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [log, setLog] = useState<string[]>([])

  const addLog = (msg: string) => setLog(prev => [...prev, msg])

  async function handlePlay() {
    setStatus('loading')
    addLog('Starting Tone.js...')
    try {
      const Tone = await import('tone')
      await Tone.start()
      addLog('Tone.js audio context started')
      const synth = new Tone.Synth().toDestination()
      addLog('Synth created, playing C4 quarter note...')
      synth.triggerAttackRelease('C4', '4n')
      setStatus('playing')
      addLog('Note triggered — you should hear a tone')
      setTimeout(() => { synth.dispose(); setStatus('idle'); addLog('Done') }, 1500)
    } catch (err) {
      setStatus('error')
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={handlePlay} disabled={status === 'loading' || status === 'playing'}>
        {status === 'idle' ? 'Play C4 note' : status === 'loading' ? 'Loading...' : status === 'playing' ? 'Playing...' : 'Error'}
      </Button>
      {log.length > 0 && (
        <ul className="font-mono text-xs text-muted-foreground space-y-1 bg-muted/20 rounded-md p-3">
          {log.map((l, i) => <li key={i}>→ {l}</li>)}
        </ul>
      )}
    </div>
  )
}
