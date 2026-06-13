import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import ShaderBackground from '@/components/ui/shader-background'
import { StaffSmokeTest } from './components/editor/StaffSmokeTest'
import { PlaybackSmokeTest } from './components/playback/PlaybackSmokeTest'
import { MicSmokeTest } from './components/audio-input/MicSmokeTest'

export default function App() {
  return (
    <TooltipProvider>
      <ShaderBackground />

      <div className="relative min-h-screen text-white p-8 space-y-10">
        <header className="border-b border-white/10 pb-4">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Aria</h1>
          <p className="text-white/50 text-sm mt-1">Setup smoke tests — all three should pass before Phase 1 begins</p>
        </header>

        <section>
          <h2 className="text-lg font-medium mb-3 text-white/80">1. VexFlow — Staff renders</h2>
          <StaffSmokeTest />
        </section>

        <section>
          <h2 className="text-lg font-medium mb-3 text-white/80">2. Tone.js — Audio plays</h2>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 inline-block">
            <PlaybackSmokeTest />
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium mb-3 text-white/80">3. Basic Pitch — Mic → pitch events</h2>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 inline-block">
            <MicSmokeTest />
          </div>
        </section>
      </div>
    </TooltipProvider>
  )
}
