import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { KeySig } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

interface KeyOption {
  fifths: number
  name: string          // major tonic for this signature
  minorName: string     // relative-minor tonic (same signature, third below)
  enharmonic?: string   // displayed below the key name (sharp/flat count)
}

// Each column is a single key signature (fixed `fifths`); the displayed tonic
// switches between the major key and its relative minor (a minor third below)
// depending on the selected mode. The signature itself never changes with mode.
const SHARP_KEYS: KeyOption[] = [
  { fifths: 0, name: 'C', minorName: 'A' },
  { fifths: 1, name: 'G', minorName: 'E', enharmonic: '1♯' },
  { fifths: 2, name: 'D', minorName: 'B', enharmonic: '2♯' },
  { fifths: 3, name: 'A', minorName: 'F♯', enharmonic: '3♯' },
  { fifths: 4, name: 'E', minorName: 'C♯', enharmonic: '4♯' },
  { fifths: 5, name: 'B', minorName: 'G♯', enharmonic: '5♯' },
  { fifths: 6, name: 'F♯', minorName: 'D♯', enharmonic: '6♯' },
  { fifths: 7, name: 'C♯', minorName: 'A♯', enharmonic: '7♯' },
]

const FLAT_KEYS: KeyOption[] = [
  { fifths: -1, name: 'F', minorName: 'D', enharmonic: '1♭' },
  { fifths: -2, name: 'B♭', minorName: 'G', enharmonic: '2♭' },
  { fifths: -3, name: 'E♭', minorName: 'C', enharmonic: '3♭' },
  { fifths: -4, name: 'A♭', minorName: 'F', enharmonic: '4♭' },
  { fifths: -5, name: 'D♭', minorName: 'B♭', enharmonic: '5♭' },
  { fifths: -6, name: 'G♭', minorName: 'E♭', enharmonic: '6♭' },
  { fifths: -7, name: 'C♭', minorName: 'A♭', enharmonic: '7♭' },
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
  const [fromMeasureText, setFromMeasureText] = useState('1')

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
      className={`flex flex-col items-center justify-center py-2 px-1.5 rounded text-xs leading-tight whitespace-nowrap transition-colors ${
        fifths === opt.fifths
          ? 'bg-violet-500/30 text-violet-300'
          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className="font-semibold text-sm">
        {mode === 'minor' ? `${opt.minorName}m` : opt.name}
      </span>
      {opt.enharmonic && <span className="text-[9px] opacity-60">{opt.enharmonic}</span>}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-96 bg-zinc-900 border-white/15 p-4" side="bottom" align="start">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Key Signature</div>

          {/* Sharps row */}
          <div>
            <div className="text-[10px] text-white/35 mb-1">Sharps</div>
            <div className="grid grid-cols-8 gap-1.5">
              {SHARP_KEYS.map(k => <KeyBtn key={k.fifths} opt={k} />)}
            </div>
          </div>

          {/* Flats row */}
          <div>
            <div className="text-[10px] text-white/35 mb-1">Flats</div>
            <div className="grid grid-cols-7 gap-1.5">
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
