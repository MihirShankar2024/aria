import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { KeySig } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

interface KeyOption {
  fifths: number
  name: string
  enharmonic?: string   // displayed below the key name
}

const SHARP_KEYS: KeyOption[] = [
  { fifths: 0, name: 'C' },
  { fifths: 1, name: 'G', enharmonic: '1♯' },
  { fifths: 2, name: 'D', enharmonic: '2♯' },
  { fifths: 3, name: 'A', enharmonic: '3♯' },
  { fifths: 4, name: 'E', enharmonic: '4♯' },
  { fifths: 5, name: 'B', enharmonic: '5♯' },
  { fifths: 6, name: 'F♯', enharmonic: '6♯' },
  { fifths: 7, name: 'C♯', enharmonic: '7♯' },
]

const FLAT_KEYS: KeyOption[] = [
  { fifths: -1, name: 'F', enharmonic: '1♭' },
  { fifths: -2, name: 'B♭', enharmonic: '2♭' },
  { fifths: -3, name: 'E♭', enharmonic: '3♭' },
  { fifths: -4, name: 'A♭', enharmonic: '4♭' },
  { fifths: -5, name: 'D♭', enharmonic: '5♭' },
  { fifths: -6, name: 'G♭', enharmonic: '6♭' },
  { fifths: -7, name: 'C♭', enharmonic: '7♭' },
]

interface KeySigPickerProps {
  current: KeySig
  measureCount: number
  dispatch: (action: ScoreAction) => void
  children: React.ReactNode
}

export function KeySigPicker({ current, measureCount, dispatch, children }: KeySigPickerProps) {
  const [open, setOpen] = useState(false)
  const [fifths, setFifths] = useState(current.fifths)
  const [mode, setMode] = useState<'major' | 'minor'>(current.mode)
  const [fromMeasure, setFromMeasure] = useState(1)

  const apply = () => {
    const keySig: KeySig = { fifths, mode }
    if (fromMeasure <= 1) {
      dispatch({ type: 'SET_GLOBAL_KEY_SIG', keySig })
    } else {
      dispatch({ type: 'SET_SCORE_KEY_SIG_AT', measureNumber: fromMeasure, keySig })
    }
    setOpen(false)
  }

  const KeyBtn = ({ opt }: { opt: KeyOption }) => (
    <button
      onClick={() => setFifths(opt.fifths)}
      className={`flex flex-col items-center py-1.5 px-1 rounded text-xs transition-colors ${
        fifths === opt.fifths
          ? 'bg-violet-500/30 text-violet-300'
          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className="font-semibold text-sm">{opt.name}</span>
      {opt.enharmonic && <span className="text-[9px] opacity-60">{opt.enharmonic}</span>}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 bg-zinc-900 border-white/15 p-4" side="bottom" align="start">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Key Signature</div>

          {/* Sharps row */}
          <div>
            <div className="text-[10px] text-white/35 mb-1">Sharps</div>
            <div className="grid grid-cols-8 gap-1">
              {SHARP_KEYS.map(k => <KeyBtn key={k.fifths} opt={k} />)}
            </div>
          </div>

          {/* Flats row */}
          <div>
            <div className="text-[10px] text-white/35 mb-1">Flats</div>
            <div className="grid grid-cols-7 gap-1">
              {FLAT_KEYS.map(k => <KeyBtn key={k.fifths} opt={k} />)}
            </div>
          </div>

          {/* Major / Minor */}
          <div className="flex gap-2">
            {(['major', 'minor'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded text-xs capitalize transition-colors ${
                  mode === m
                    ? 'bg-violet-500/30 text-violet-300'
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* From measure */}
          <div>
            <Label className="text-[10px] text-white/40 uppercase tracking-wider">From measure</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min={1}
                max={measureCount}
                value={fromMeasure}
                onChange={e => setFromMeasure(Math.max(1, Math.min(measureCount, parseInt(e.target.value) || 1)))}
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
