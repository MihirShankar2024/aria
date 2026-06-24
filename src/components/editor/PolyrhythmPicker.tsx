import { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { NoteGlyph } from './DockPickers'
import type { Duration } from '../../types/score'

/** A polyrhythm stated explicitly as `played` notes in the space of `inSpaceOf` notes of
 *  written value `baseDuration` (e.g. 3 in the space of 2 eighths = a 3:2 eighth triplet).
 *  All three numbers map 1:1 to the underlying tuplet — nothing is inferred. */
export interface TupletSpec {
  played: number
  inSpaceOf: number
  baseDuration: Duration
}

/** Note-value choices for one tuplet slot. Each renders as an SVG note glyph (whole/half have
 *  no usable Unicode symbol), so every value down to a whole note can be picked. */
const VALUES: { value: Duration; name: string }[] = [
  { value: 'whole', name: 'Whole' },
  { value: 'half', name: 'Half' },
  { value: 'quarter', name: 'Quarter' },
  { value: 'eighth', name: 'Eighth' },
  { value: 'sixteenth', name: 'Sixteenth' },
]

const nameFor = (d: Duration) => VALUES.find(v => v.value === d)?.name.toLowerCase() ?? ''

const PRESETS: { spec: TupletSpec; label: string; name: string }[] = [
  { spec: { played: 3, inSpaceOf: 2, baseDuration: 'eighth' }, label: '3:2 ♪', name: 'Triplet (eighths)' },
  { spec: { played: 3, inSpaceOf: 2, baseDuration: 'quarter' }, label: '3:2 ♩', name: 'Triplet (quarters)' },
  { spec: { played: 6, inSpaceOf: 4, baseDuration: 'quarter' }, label: '6:4 ♩', name: '6 quarters in 4' },
  { spec: { played: 5, inSpaceOf: 4, baseDuration: 'quarter' }, label: '5:4 ♩', name: '5 quarters in 4' },
  { spec: { played: 5, inSpaceOf: 2, baseDuration: 'eighth' }, label: '5:2 ♪', name: '5 eighths in 2' },
  { spec: { played: 4, inSpaceOf: 3, baseDuration: 'quarter' }, label: '4:3 ♩', name: 'Quadruplet (quarters)' },
]

interface PolyrhythmPickerProps {
  current: TupletSpec
  onChange: (spec: TupletSpec) => void
  /** Confirm the chosen spec (e.g. arm entry) and close the panel — fired by the Enter button. */
  onConfirm?: (spec: TupletSpec) => void
  children: React.ReactNode
}

/**
 * Hover-opened panel for choosing a polyrhythm, mirroring the signature pickers. You state the
 * tuplet in full — `played` notes in the space of `inSpaceOf` notes of a chosen written value —
 * so nothing is guessed: the ratio and the note value are exactly what you set. Opens to the
 * current spec so the most recent one is one click away.
 */
export function PolyrhythmPicker({ current, onChange, onConfirm, children }: PolyrhythmPickerProps) {
  const [open, setOpen] = useState(false)
  const [playedText, setPlayedText] = useState(String(current.played))
  const [inSpaceText, setInSpaceText] = useState(String(current.inSpaceOf))
  const [baseDuration, setBaseDuration] = useState<Duration>(current.baseDuration)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }

  const isCurrent = (s: TupletSpec) =>
    current.played === s.played && current.inSpaceOf === s.inSpaceOf && current.baseDuration === s.baseDuration

  // Parse + clamp the typed fields into a valid spec.
  const readSpec = (): TupletSpec => ({
    played: Math.max(2, Math.min(16, parseInt(playedText) || current.played)),
    inSpaceOf: Math.max(1, Math.min(16, parseInt(inSpaceText) || current.inSpaceOf)),
    baseDuration,
  })

  const syncFields = (s: TupletSpec) => {
    setPlayedText(String(s.played))
    setInSpaceText(String(s.inSpaceOf))
    setBaseDuration(s.baseDuration)
  }

  const applyCustom = () => {
    const spec = readSpec()
    syncFields(spec)
    onChange(spec)
  }

  // Enter button: commit the spec, arm entry, and close — so a value can't be lost by the panel
  // closing before a field blur registers.
  const confirm = () => {
    const spec = readSpec()
    syncFields(spec)
    onChange(spec)
    onConfirm?.(spec)
    setOpen(false)
  }

  const preview = readSpec()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex" onMouseEnter={() => { cancelClose(); setOpen(true) }} onMouseLeave={scheduleClose}>
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-60 bg-zinc-900 border-white/15 p-4"
        onOpenAutoFocus={e => e.preventDefault()}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="space-y-4">
          <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">Polyrhythm</div>

          <div className="grid grid-cols-3 gap-1">
            {PRESETS.map(({ spec, label, name }) => (
              <button
                key={label}
                title={name}
                onClick={() => {
                  syncFields(spec)
                  onChange(spec)
                  onConfirm?.(spec)
                }}
                className={`py-1.5 rounded text-sm font-mono transition-colors ${
                  isCurrent(spec)
                    ? 'bg-violet-500/30 text-violet-300'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-end justify-center gap-2">
            <div className="w-12">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Notes</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={playedText}
                onChange={e => setPlayedText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={e => { if (e.key === 'Enter') confirm() }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm text-center"
              />
            </div>
            <div className="text-white/30 text-[10px] mb-2 leading-tight text-center shrink-0">in space<br />of</div>
            <div className="w-12">
              <Label className="text-[10px] text-white/40 uppercase tracking-wider">Of</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={inSpaceText}
                onChange={e => setInSpaceText(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={e => { if (e.key === 'Enter') confirm() }}
                className="h-8 bg-white/5 border-white/15 text-white text-sm text-center"
              />
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-white/40 uppercase tracking-wider">Value</Label>
            <div className="mt-1 flex items-stretch gap-1">
              {VALUES.map(({ value, name }) => (
                <button
                  key={value}
                  title={name}
                  onClick={() => {
                    setBaseDuration(value)
                    onChange({ ...readSpec(), baseDuration: value })
                  }}
                  className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors ${
                    baseDuration === value
                      ? 'bg-violet-500/30 text-violet-200 ring-1 ring-violet-400/40'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <NoteGlyph dur={value} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>

          <div className="text-center text-[11px] text-white/40">
            {preview.played} {nameFor(baseDuration)} note{preview.played === 1 ? '' : 's'} in the space of {preview.inSpaceOf}
          </div>

          <button
            onClick={confirm}
            className="w-full rounded bg-violet-500/25 py-1.5 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/40"
          >
            Enter
          </button>

          <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-3">
            <p className="text-[11px] leading-snug text-white/45">
              Play the a number of notes in the time the second number would normally take, with a
              chosen note value (3 eights in the space of 2 eighths = a triplet). Choose a common polyrhythm, or write your own and press enter, then place notes
              to fill it.
            </p>
            <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">P</kbd>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
