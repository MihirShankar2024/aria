import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import ShaderBackground from '@/components/ui/shader-background'
import { ScoreEditor } from './components/editor/ScoreEditor'

export default function App() {
  return (
    <TooltipProvider>
      <ShaderBackground />
      <div className="relative">
        <ScoreEditor />
      </div>
    </TooltipProvider>
  )
}
