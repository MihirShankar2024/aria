import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Slider } from '../ui/slider'
import { Label } from '../ui/label'
import type { ScoreAction } from '../../state/actions'

const TEMPO_MARKS: { label: string; bpm: number }[] = [
  { label: 'Largo', bpm: 50 },
  { label: 'Andante', bpm: 76 },
  { label: 'Moderato', bpm: 108 },
  { label: 'Allegro', bpm: 132 },
  { label: 'Presto', bpm: 188 },
]

interface TempoPickerProps {
  initialTempo: number
  measureCount: number
  dispatch: (action: ScoreAction) => void
  children: React.ReactNode
}

export function TempoPicker({ initialTempo, measureCount, dispatch, children }: TempoPickerProps) {
  const [open, setOpen] = useState(false)
  const [bpm, setBpm] = useState(initialTempo)
  const [bpmText, setBpmText] = useState(String(initialTempo))
  const [fromMeasure, setFromMeasure] = useState(1)
  const [fromMeasureText, setFromMeasureText] = useState('1')

  const clamp = (v: number) => Math.max(20, Math.min(300, v))

  // Slider/preset changes drive the canonical bpm; keep the text field showing it too.
  const setBpmSynced = (v: number) => {
    setBpm(v)
    setBpmText(String(v))
  }

  const apply = () => {
    if (fromMeasure <= 1) {
      dispatch({ type: 'SET_TEMPO', tempo: bpm })
    } else {
      dispatch({ type: 'SET_MEASURE_TEMPO', measureNumber: fromMeasure, tempo: bpm })
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-60 bg-zinc-900 border-white/15 p-4" side="bottom" align="start">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Tempo</div>

          {/* BPM display + input */}
          <div className="flex items-center gap-3">
            <span className="text-white/50 text-sm">♩ =</span>
            <Input
              type="text"
              inputMode="numeric"
              value={bpmText}
              onChange={e => {
                setBpmText(e.target.value)
                const n = parseInt(e.target.value)
                if (!isNaN(n)) setBpm(clamp(n))
              }}
              onBlur={() => {
                const clamped = clamp(parseInt(bpmText) || 60)
                setBpm(clamped)
                setBpmText(String(clamped))
              }}
              className="h-9 bg-white/5 border-white/15 text-white text-lg font-semibold w-24 text-center"
            />
            <span className="text-white/40 text-xs">BPM</span>
          </div>

          {/* Slider */}
          <Slider
            min={20}
            max={300}
            step={1}
            value={[bpm]}
            onValueChange={([v]) => setBpmSynced(v)}
            className="w-full"
          />

          {/* Tempo marks */}
          <div className="flex flex-wrap gap-1">
            {TEMPO_MARKS.map(({ label, bpm: b }) => (
              <button
                key={label}
                onClick={() => setBpmSynced(b)}
                className="px-2 py-1 rounded text-[10px] bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* From measure */}
          <div>
            <Label className="text-[10px] text-white/40 uppercase tracking-wider">From measure</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="text"
                inputMode="numeric"
                value={fromMeasureText}
                onChange={e => {
                  setFromMeasureText(e.target.value)
                  const n = parseInt(e.target.value)
                  if (!isNaN(n)) setFromMeasure(Math.max(1, Math.min(measureCount, n)))
                }}
                onBlur={() => {
                  const clamped = Math.max(1, Math.min(measureCount, parseInt(fromMeasureText) || 1))
                  setFromMeasure(clamped)
                  setFromMeasureText(String(clamped))
                }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm w-20"
              />
              <span className="text-xs text-white/40">
                {fromMeasure <= 1 ? '(global)' : `(from m.${fromMeasure})`}
              </span>
            </div>
          </div>

          <Button
            onClick={apply}
            className="w-full h-8 bg-violet-600 hover:bg-violet-500 text-white text-sm"
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
