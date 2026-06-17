import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { TimeSig } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const COMMON_TIME_SIGS: { beats: number; beatType: number; label: string }[] = [
  { beats: 4, beatType: 4, label: '4/4' },
  { beats: 3, beatType: 4, label: '3/4' },
  { beats: 2, beatType: 4, label: '2/4' },
  { beats: 6, beatType: 8, label: '6/8' },
  { beats: 9, beatType: 8, label: '9/8' },
  { beats: 12, beatType: 8, label: '12/8' },
  { beats: 2, beatType: 2, label: '2/2' },
  { beats: 5, beatType: 4, label: '5/4' },
  { beats: 7, beatType: 8, label: '7/8' },
]

const BEAT_TYPES = [2, 4, 8, 16]

interface TimeSigPickerProps {
  current: TimeSig
  measureCount: number
  dispatch: (action: ScoreAction) => void
  children: React.ReactNode
}

export function TimeSigPicker({ current, measureCount, dispatch, children }: TimeSigPickerProps) {
  const [open, setOpen] = useState(false)
  const [beats, setBeats] = useState(current.beats)
  const [beatsText, setBeatsText] = useState(String(current.beats))
  const [beatType, setBeatType] = useState(current.beatType)
  const [fromMeasure, setFromMeasure] = useState(1)
  const [fromMeasureText, setFromMeasureText] = useState('1')

  const apply = () => {
    const timeSig: TimeSig = { beats, beatType }
    if (fromMeasure <= 1) {
      dispatch({ type: 'SET_GLOBAL_TIME_SIG', timeSig })
    } else {
      dispatch({ type: 'SET_SCORE_TIME_SIG_AT', measureNumber: fromMeasure, timeSig })
    }
    setOpen(false)
  }

  const preset = (b: number, bt: number) => {
    setBeats(b)
    setBeatsText(String(b))
    setBeatType(bt)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-60 bg-zinc-900 border-white/15 p-4" side="bottom" align="start">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Time Signature</div>

          {/* Common presets */}
          <div className="grid grid-cols-3 gap-1">
            {COMMON_TIME_SIGS.map(({ beats: b, beatType: bt, label }) => (
              <button
                key={label}
                onClick={() => preset(b, bt)}
                className={`py-1.5 rounded text-sm font-mono transition-colors ${
                  beats === b && beatType === bt
                    ? 'bg-violet-500/30 text-violet-300'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Custom */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Beats</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={beatsText}
                onChange={e => {
                  setBeatsText(e.target.value)
                  const n = parseInt(e.target.value)
                  if (!isNaN(n)) setBeats(Math.max(1, Math.min(16, n)))
                }}
                onBlur={() => {
                  const clamped = Math.max(1, Math.min(16, parseInt(beatsText) || 4))
                  setBeats(clamped)
                  setBeatsText(String(clamped))
                }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm"
              />
            </div>
            <div className="text-white/30 text-xl mt-4">/</div>
            <div className="flex-1">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Beat type</Label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {BEAT_TYPES.map(bt => (
                  <button
                    key={bt}
                    onClick={() => setBeatType(bt)}
                    className={`py-1 rounded text-xs font-mono transition-colors ${
                      beatType === bt
                        ? 'bg-violet-500/30 text-violet-300'
                        : 'bg-white/5 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    {bt}
                  </button>
                ))}
              </div>
            </div>
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
                {fromMeasure <= 1 ? '(applies globally)' : `(measure ${fromMeasure}+)`}
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
