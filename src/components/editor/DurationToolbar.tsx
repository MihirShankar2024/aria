import { Trash2, Eraser, MousePointer2 } from 'lucide-react'
import { Toggle } from '../ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { TimeSigPicker } from './TimeSigPicker'
import { KeySigPicker } from './KeySigPicker'
import { TempoPicker } from './TempoPicker'
import type { Duration, Accidental, TimeSig, KeySig } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const DURATIONS: { value: Duration; label: string; title: string }[] = [
  { value: 'whole', label: 'W', title: 'Whole' },
  { value: 'half', label: 'H', title: 'Half' },
  { value: 'quarter', label: 'Q', title: 'Quarter' },
  { value: 'eighth', label: '8', title: 'Eighth' },
  { value: 'sixteenth', label: '16', title: 'Sixteenth' },
]

const ACCIDENTALS: { value: NonNullable<Accidental>; label: string; title: string }[] = [
  { value: 'natural', label: '♮', title: 'Natural' },
  { value: 'sharp', label: '♯', title: 'Sharp' },
  { value: 'flat', label: '♭', title: 'Flat' },
]

const TOGGLE_ITEM_CLASS =
  'h-8 px-2.5 text-xs font-medium text-white/50 rounded-md ' +
  'hover:text-white hover:bg-white/10 ' +
  'data-[state=on]:text-white data-[state=on]:bg-violet-500/25'

const TOOLBAR_BTN_CLASS =
  'h-8 px-2.5 text-xs font-medium text-white/50 rounded-md ' +
  'hover:text-white hover:bg-white/10 transition-colors'

interface DurationToolbarProps {
  selectedDuration: Duration
  onDurationChange: (d: Duration) => void
  isDotted: boolean
  onDottedChange: (v: boolean) => void
  isRest: boolean
  onRestChange: (v: boolean) => void
  selectedAccidental: Accidental
  onAccidentalChange: (a: Accidental) => void
  isTieMode: boolean
  onTieModeChange: (v: boolean) => void
  isFillMode: boolean
  onFillModeChange: (v: boolean) => void
  isDeleteMode: boolean
  onDeleteModeChange: (v: boolean) => void
  isInsertMode: boolean
  onInsertModeChange: (v: boolean) => void
  isSelectMode: boolean
  onSelectModeChange: (v: boolean) => void
  selectedNoteCount: number
  onDeleteSelected: () => void
  hasPendingRests: boolean
  onCollapseRests: () => void
  // Score-level props for pickers
  globalTimeSig: TimeSig
  globalKeySig: KeySig
  initialTempo: number
  measureCount: number
  dispatch: (action: ScoreAction) => void
}

export function DurationToolbar({
  selectedDuration,
  onDurationChange,
  isDotted,
  onDottedChange,
  isRest,
  onRestChange,
  selectedAccidental,
  onAccidentalChange,
  isTieMode,
  onTieModeChange,
  isFillMode,
  onFillModeChange,
  isDeleteMode,
  onDeleteModeChange,
  isInsertMode,
  onInsertModeChange,
  isSelectMode,
  onSelectModeChange,
  selectedNoteCount,
  onDeleteSelected,
  hasPendingRests,
  onCollapseRests,
  globalTimeSig,
  globalKeySig,
  initialTempo,
  measureCount,
  dispatch,
}: DurationToolbarProps) {
  return (
    <div className="flex items-center flex-wrap gap-2">
      <div className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
        {/* Duration group */}
        <ToggleGroup
          type="single"
          value={selectedDuration}
          onValueChange={(v) => { if (v) onDurationChange(v as Duration) }}
          className="gap-0.5"
        >
          {DURATIONS.map(({ value, label, title }) => (
            <ToggleGroupItem key={value} value={value} title={title} className={TOGGLE_ITEM_CLASS}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="w-px h-5 bg-white/15" />

        {/* Modifiers */}
        <div className="flex gap-0.5">
          <Toggle pressed={isDotted} onPressedChange={onDottedChange} title="Dotted" className={TOGGLE_ITEM_CLASS}>·</Toggle>
          <Toggle pressed={isRest} onPressedChange={onRestChange} title="Rest" className={TOGGLE_ITEM_CLASS + ' font-serif'}>𝄽</Toggle>
        </div>

        <div className="w-px h-5 bg-white/15" />

        {/* Accidentals */}
        <ToggleGroup
          type="single"
          value={selectedAccidental ?? ''}
          onValueChange={(v) => onAccidentalChange(v ? (v as NonNullable<Accidental>) : null)}
          className="gap-0.5"
        >
          {ACCIDENTALS.map(({ value, label, title }) => (
            <ToggleGroupItem key={value} value={value} title={title} className={TOGGLE_ITEM_CLASS + ' text-base'}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="w-px h-5 bg-white/15" />

        {/* Tie / slur */}
        <Toggle pressed={isTieMode} onPressedChange={onTieModeChange} title="Tie / slur — drag between two notes (T)" className={TOGGLE_ITEM_CLASS + ' text-base'}>
          ⌒
        </Toggle>

        <div className="w-px h-5 bg-white/15" />

        {/* Insert before/between — drop a V marker, build notes in the scratch staff */}
        <Toggle pressed={isInsertMode} onPressedChange={onInsertModeChange} title="Insert notes before/between — click a gap, build, then ✓ (I)" className={TOGGLE_ITEM_CLASS + ' text-base'}>
          ⌄
        </Toggle>

        <div className="w-px h-5 bg-white/15" />

        {/* Fill rests */}
        <Toggle pressed={isFillMode} onPressedChange={onFillModeChange} title="Fill rests — click a measure to fill it" className={TOGGLE_ITEM_CLASS}>
          𝄽+
        </Toggle>

        <div className="w-px h-5 bg-white/15" />

        {/* Select */}
        <div className="relative">
          <Toggle
            pressed={isSelectMode}
            onPressedChange={onSelectModeChange}
            title="Select — draw box to select notes (Esc to clear)"
            className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </Toggle>
          {isSelectMode && selectedNoteCount > 0 && (
            <button
              onClick={onDeleteSelected}
              title="Delete selected notes"
              className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/30 text-violet-200 hover:bg-violet-500/50 ring-1 ring-violet-400/50 animate-in fade-in"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="w-px h-5 bg-white/15" />

        {/* Erase */}
        <div className="relative">
          <Toggle
            pressed={isDeleteMode}
            onPressedChange={onDeleteModeChange}
            title="Erase — drag over notes to delete (Delete)"
            className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-red-500/25 data-[state=on]:text-red-300'}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Toggle>
          {hasPendingRests && (
            <button
              onClick={onCollapseRests}
              title="Remove rests — collapse the red rests (Tab)"
              className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 flex h-6 w-6 items-center justify-center rounded-md bg-red-500/30 text-red-200 hover:bg-red-500/50 ring-1 ring-red-400/50 animate-in fade-in"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Notation controls */}
      <div className="inline-flex items-center gap-1 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
        <TimeSigPicker current={globalTimeSig} measureCount={measureCount} dispatch={dispatch}>
          <button className={TOOLBAR_BTN_CLASS} title="Time signature">
            <span className="font-mono">{globalTimeSig.beats}/{globalTimeSig.beatType}</span>
          </button>
        </TimeSigPicker>

        <div className="w-px h-5 bg-white/15" />

        <KeySigPicker current={globalKeySig} measureCount={measureCount} dispatch={dispatch}>
          <button className={TOOLBAR_BTN_CLASS} title="Key signature">
            <span className="font-medium">{keySigLabel(globalKeySig)}</span>
          </button>
        </KeySigPicker>

        <div className="w-px h-5 bg-white/15" />

        <TempoPicker initialTempo={initialTempo} measureCount={measureCount} dispatch={dispatch}>
          <button className={TOOLBAR_BTN_CLASS} title="Tempo">
            <span className="font-mono">♩={initialTempo}</span>
          </button>
        </TempoPicker>
      </div>
    </div>
  )
}

function keySigLabel(keySig: KeySig): string {
  const NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']
  const name = NAMES[(keySig.fifths + 7) % 15] ?? 'C'
  return `${name} ${keySig.mode === 'minor' ? 'm' : ''}`
}
