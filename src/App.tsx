import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import ShaderBackground from '@/components/ui/shader-background'
import { ScoreEditor } from './components/editor/ScoreEditor'

export default function App() {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
      <ShaderBackground />
      <div className="relative">
        <ScoreEditor />
      </div>
    </TooltipProvider>
  )
}
