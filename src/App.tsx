import './index.css'
import { StaffSmokeTest } from './components/editor/StaffSmokeTest'
import { PlaybackSmokeTest } from './components/playback/PlaybackSmokeTest'
import { MicSmokeTest } from './components/audio-input/MicSmokeTest'

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-10">
      <header className="border-b border-border pb-4">
        <h1 className="text-3xl font-semibold tracking-tight text-primary">Aria</h1>
        <p className="text-muted-foreground text-sm mt-1">Setup smoke tests — all three should pass before Phase 1 begins</p>
      </header>

      <section>
        <h2 className="text-lg font-medium mb-3 text-foreground">1. VexFlow — Staff renders</h2>
        <StaffSmokeTest />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3 text-foreground">2. Tone.js — Audio plays</h2>
        <PlaybackSmokeTest />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3 text-foreground">3. Basic Pitch — Mic → pitch events</h2>
        <MicSmokeTest />
      </section>
    </div>
  )
}
