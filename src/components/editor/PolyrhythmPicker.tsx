import { useState } from 'react'
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

/** A polyrhythm entered as `played` notes spanning `beats` quarter-note beats. The inner
 *  ratio and reserved note value are derived from these two (see `deriveTuplet`). */
export interface TupletSpec {
  played: number
  beats: number
}

const PRESETS: { played: number; beats: number; label: string; name: string }[] = [
  { played: 3, beats: 1, label: '3 / 1', name: 'Triplet (eighths)' },
  { played: 5, beats: 1, label: '5 / 1', name: 'Quintuplet' },
  { played: 6, beats: 1, label: '6 / 1', name: 'Sextuplet' },
  { played: 7, beats: 1, label: '7 / 1', name: 'Septuplet' },
  { played: 4, beats: 3, label: '4 / 3', name: 'Quadruplet' },
  { played: 3, beats: 2, label: '3 / 2', name: 'Triplet (quarters)' },
]

interface PolyrhythmPickerProps {
  current: TupletSpec
  onChange: (spec: TupletSpec) => void
  /** Confirm the chosen spec (e.g. arm entry) and close the panel — fired by the Enter button. */
  onConfirm?: (spec: TupletSpec) => void
  children: React.ReactNode
}

/**
 * Hover-opened panel for choosing a polyrhythm, mirroring the signature pickers. You set the
 * number of notes and the total length they span (in beats); the engine derives the tuplet
 * ratio so the span is fixed up front and ordinary note values fill it. Opens to the current
 * spec so the most recent one is one click away.
 */
export function PolyrhythmPicker({ current, onChange, onConfirm, children }: PolyrhythmPickerProps) {
  const [open, setOpen] = useState(false)
  const [playedText, setPlayedText] = useState(String(current.played))
  const [beatsText, setBeatsText] = useState(String(current.beats))

  const isCurrent = (p: number, b: number) => current.played === p && current.beats === b

  // Parse + clamp the typed fields into a valid spec.
  const readSpec = (): TupletSpec => ({
    played: Math.max(2, Math.min(16, parseInt(playedText) || current.played)),
    beats: Math.max(0.25, Math.min(16, parseFloat(beatsText) || current.beats)),
  })

  const applyCustom = () => {
    const spec = readSpec()
    setPlayedText(String(spec.played))
    setBeatsText(String(spec.beats))
    onChange(spec)
  }

  // Enter button: commit the spec, arm entry, and close — so a value can't be lost by the panel
  // closing before a field blur registers.
  const confirm = () => {
    const spec = readSpec()
    setPlayedText(String(spec.played))
    setBeatsText(String(spec.beats))
    onChange(spec)
    onConfirm?.(spec)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex" onMouseEnter={() => setOpen(true)}>
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-56 bg-zinc-900 border-white/15 p-4"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Polyrhythm</div>

          <div className="grid grid-cols-3 gap-1">
            {PRESETS.map(({ played, beats, label, name }) => (
              <button
                key={label}
                title={name}
                onClick={() => {
                  const spec = { played, beats }
                  setPlayedText(String(played))
                  setBeatsText(String(beats))
                  onChange(spec)
                  onConfirm?.(spec)
                }}
                className={`py-1.5 rounded text-sm font-mono transition-colors ${
                  isCurrent(played, beats)
                    ? 'bg-violet-500/30 text-violet-300'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Notes</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={playedText}
                onChange={e => setPlayedText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={e => { if (e.key === 'Enter') confirm() }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm"
              />
            </div>
            <div className="text-white/30 text-sm mb-2">in</div>
            <div className="flex-1">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Beats</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={beatsText}
                onChange={e => setBeatsText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={e => { if (e.key === 'Enter') confirm() }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm"
              />
            </div>
          </div>

          <button
            onClick={confirm}
            className="w-full rounded bg-violet-500/25 py-1.5 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/40"
          >
            Enter
          </button>

          <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-3">
            <p className="text-[11px] leading-snug text-white/45">
              Fit this many notes into the given number of beats (e.g. 3 in 1 = a triplet), then click
              Enter and place ordinary note values to fill it.
            </p>
            <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">P</kbd>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
