import type { ReactNode } from 'react'
import { Trash2, Eraser, MousePointer2, Brush, Crosshair, StepForward, Music2 } from 'lucide-react'
import { Toggle } from '../ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import { PolyrhythmPicker, type TupletSpec } from './PolyrhythmPicker'
import { TimeSigPicker } from './TimeSigPicker'
import { KeySigPicker } from './KeySigPicker'
import { TempoPicker } from './TempoPicker'
import type { Duration, Accidental, TimeSig, KeySig, VoiceNumber } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

const DURATIONS: { value: Duration; label: string; name: string; desc: string; keys: string }[] = [
  { value: 'whole', label: 'W', name: 'Whole note', desc: 'Place whole notes.', keys: 'W' },
  { value: 'half', label: 'H', name: 'Half note', desc: 'Place half notes.', keys: 'H' },
  { value: 'quarter', label: 'Q', name: 'Quarter note', desc: 'Place quarter notes.', keys: 'Q' },
  { value: 'eighth', label: '8', name: 'Eighth note', desc: 'Place eighth notes.', keys: 'E / 8' },
  { value: 'sixteenth', label: '16', name: 'Sixteenth note', desc: 'Place sixteenth notes.', keys: 'X / 6' },
]

// Tuplet ratio presets: `played` notes in the time of `inSpaceOf`.
const TUPLET_PRESETS: { played: number; inSpaceOf: number; label: string }[] = [
  { played: 3, inSpaceOf: 2, label: 'triplet (3:2)' },
  { played: 5, inSpaceOf: 4, label: 'quintuplet (5:4)' },
  { played: 6, inSpaceOf: 4, label: 'sextuplet (6:4)' },
  { played: 7, inSpaceOf: 8, label: 'septuplet (7:8)' },
]

const ACCIDENTALS: { value: NonNullable<Accidental>; label: string; name: string; desc: string; keys: string }[] = [
  { value: 'natural', label: '♮', name: 'Natural', desc: 'Cancel the key signature on placed notes.', keys: 'N' },
  { value: 'sharp', label: '♯', name: 'Sharp', desc: 'Raise placed notes a semitone.', keys: 'S' },
  { value: 'flat', label: '♭', name: 'Flat', desc: 'Lower placed notes a semitone.', keys: 'F' },
]

/** Rich hover bubble for a dock tool: bold name, keybind chip, one-line description. */
function DockTip({ name, desc, keys, children }: { name: string; desc: ReactNode; keys?: string | string[]; children: ReactNode }) {
  const keyList = keys ? (Array.isArray(keys) ? keys : [keys]) : []
  return (
    <Tooltip>
      {/* Wrapper span is the trigger so the tooltip's own data-state doesn't
          clobber the toggle's data-[state=on] selected styling. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-60 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-white">{name}</span>
          {keyList.length > 0 && (
            <span className="flex gap-1 shrink-0">
              {keyList.map(k => (
                <kbd key={k} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">{k}</kbd>
              ))}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-white/55">{desc}</div>
      </TooltipContent>
    </Tooltip>
  )
}

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
  tupletEntry: boolean
  onTupletEntryChange: (v: boolean) => void
  tupletSpec: TupletSpec
  onTupletSpecChange: (s: TupletSpec) => void
  activeVoice: VoiceNumber
  onActiveVoiceChange: (v: VoiceNumber) => void
  selectedAccidental: Accidental
  onAccidentalChange: (a: Accidental) => void
  isTieMode: boolean
  onTieModeChange: (v: boolean) => void
  isFillMode: boolean
  onFillModeChange: (v: boolean) => void
  isDeleteMode: boolean
  onDeleteModeChange: (v: boolean) => void
  isBroomMode: boolean
  onBroomModeChange: (v: boolean) => void
  isInsertMode: boolean
  onInsertModeChange: (v: boolean) => void
  isSelectMode: boolean
  onSelectModeChange: (v: boolean) => void
  isSharpshooterMode: boolean
  onSharpshooterModeChange: (v: boolean) => void
  advanceOnPlace: boolean
  onAdvanceOnPlaceChange: (v: boolean) => void
  transposedView: boolean
  onTransposedViewChange: (v: boolean) => void
  selectedNoteCount: number
  onDeleteSelected: () => void
  onMakeTuplet: (played: number, inSpaceOf: number) => void
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
  tupletEntry,
  onTupletEntryChange,
  tupletSpec,
  onTupletSpecChange,
  activeVoice,
  onActiveVoiceChange,
  selectedAccidental,
  onAccidentalChange,
  isTieMode,
  onTieModeChange,
  isFillMode,
  onFillModeChange,
  isDeleteMode,
  onDeleteModeChange,
  isBroomMode,
  onBroomModeChange,
  isInsertMode,
  onInsertModeChange,
  isSelectMode,
  onSelectModeChange,
  isSharpshooterMode,
  onSharpshooterModeChange,
  advanceOnPlace,
  onAdvanceOnPlaceChange,
  transposedView,
  onTransposedViewChange,
  selectedNoteCount,
  onDeleteSelected,
  onMakeTuplet,
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
          {DURATIONS.map(({ value, label, name, desc, keys }) => (
            <DockTip key={value} name={name} desc={desc} keys={keys}>
              <ToggleGroupItem value={value} className={TOGGLE_ITEM_CLASS}>
                {label}
              </ToggleGroupItem>
            </DockTip>
          ))}
        </ToggleGroup>

        <div className="w-px h-5 bg-white/15" />

        {/* Rest mode — its own thing */}
        <DockTip name="Rest" desc="Place rests instead of notes." keys="Space">
          <Toggle pressed={isRest} onPressedChange={onRestChange} className={TOGGLE_ITEM_CLASS + ' font-serif'}>𝄽</Toggle>
        </DockTip>

        {/* Polyrhythm entry — hover for the ratio panel (which carries its own description),
            click to arm. The next notes flow into a reserved tuplet of the chosen ratio. */}
        <PolyrhythmPicker
          current={tupletSpec}
          onChange={onTupletSpecChange}
          onConfirm={spec => { onTupletSpecChange(spec); onTupletEntryChange(true) }}
        >
          <Toggle
            pressed={tupletEntry}
            onPressedChange={onTupletEntryChange}
            className={TOGGLE_ITEM_CLASS + ' font-mono tabular-nums data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
          >
            <span>{tupletSpec.played}</span>
            <span className="text-[9px] text-white/40 ml-0.5">:{tupletSpec.inSpaceOf}</span>
          </Toggle>
        </PolyrhythmPicker>

        <div className="w-px h-5 bg-white/15" />

        {/* Dot + accidentals — one group */}
        <div className="flex items-center gap-0.5">
          <DockTip name="Dotted" desc="Add an augmentation dot (×1.5 duration)." keys="D / .">
            <Toggle pressed={isDotted} onPressedChange={onDottedChange} className={TOGGLE_ITEM_CLASS}>·</Toggle>
          </DockTip>
          <ToggleGroup
            type="single"
            value={selectedAccidental ?? ''}
            onValueChange={(v) => onAccidentalChange(v ? (v as NonNullable<Accidental>) : null)}
            className="gap-0.5"
          >
            {ACCIDENTALS.map(({ value, label, name, desc, keys }) => (
              <DockTip key={value} name={name} desc={desc} keys={keys}>
                <ToggleGroupItem value={value} className={TOGGLE_ITEM_CLASS + ' text-base'}>
                  {label}
                </ToggleGroupItem>
              </DockTip>
            ))}
          </ToggleGroup>
        </div>

        <div className="w-px h-5 bg-white/15" />

        {/* Voice — voice 1 stems up, voice 2 stems down */}
        <ToggleGroup
          type="single"
          value={String(activeVoice)}
          onValueChange={(v) => { if (v) onActiveVoiceChange(Number(v) as VoiceNumber) }}
          className="gap-0.5"
        >
          <DockTip name="Voice 1" desc="Active voice — stems up." keys="V">
            <ToggleGroupItem value="1" className={TOGGLE_ITEM_CLASS}>V1</ToggleGroupItem>
          </DockTip>
          <DockTip name="Voice 2" desc="Active voice — stems down. Hold Alt/Option while placing to drop into voice 2." keys="V">
            <ToggleGroupItem value="2" className={TOGGLE_ITEM_CLASS}>V2</ToggleGroupItem>
          </DockTip>
        </ToggleGroup>
      </div>

      {/* Modes bubble */}
      <div className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
        {/* Tie / slur */}
        <DockTip name="Tie / slur" desc="Drag between two notes to connect them with a tie or slur." keys="T">
          <Toggle pressed={isTieMode} onPressedChange={onTieModeChange} className={TOGGLE_ITEM_CLASS + ' text-base'}>
            ⌒
          </Toggle>
        </DockTip>

        <div className="w-px h-5 bg-white/15" />

        {/* Insert before/between — drop a V marker, build notes in the scratch staff */}
        <DockTip name="Insert" desc="Click a gap to insert notes before or between existing ones, build in the scratch staff, then confirm with ✓." keys="I">
          <Toggle pressed={isInsertMode} onPressedChange={onInsertModeChange} className={TOGGLE_ITEM_CLASS + ' text-base'}>
            ⌄
          </Toggle>
        </DockTip>

        <div className="w-px h-5 bg-white/15" />

        {/* Fill rests */}
        <DockTip name="Fill rests" desc="Click a measure to pad it out to full with rests.">
          <Toggle pressed={isFillMode} onPressedChange={onFillModeChange} className={TOGGLE_ITEM_CLASS}>
            𝄽+
          </Toggle>
        </DockTip>

        <div className="w-px h-5 bg-white/15" />

        {/* Select */}
        <div className="relative">
          <DockTip
            name="Select"
            keys="⇧"
            desc={
              <>
                Drag a box to select notes. Esc to clear.
                <ul className="mt-1 space-y-0.5 list-none">
                  <li>Drag selection to reposition notes</li>
                  <li>↑ / ↓ to shift pitch by a step</li>
                  <li>Ctrl+C / Ctrl+X to copy / cut</li>
                </ul>
              </>
            }
          >
            <Toggle
              pressed={isSelectMode}
              onPressedChange={onSelectModeChange}
              className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </Toggle>
          </DockTip>
          {isSelectMode && selectedNoteCount > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 flex items-center gap-1 animate-in fade-in">
              <button
                onClick={onDeleteSelected}
                title="Delete selected notes"
                className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/30 text-violet-200 hover:bg-violet-500/50 ring-1 ring-violet-400/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {selectedNoteCount >= 2 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      title="Group selection into a tuplet"
                      className="flex h-6 min-w-6 items-center justify-center rounded-md bg-violet-500/30 px-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/50 ring-1 ring-violet-400/50"
                    >
                      3
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="center" className="w-auto p-1.5">
                    <div className="flex flex-col gap-0.5">
                      {TUPLET_PRESETS.map(({ played, inSpaceOf, label }) => (
                        <button
                          key={label}
                          onClick={() => onMakeTuplet(played, inSpaceOf)}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                        >
                          <span className="font-semibold">{played}</span>
                          <span className="text-white/45">{label}</span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-white/15" />

        {/* Sharpshooter — move slur/tie handles + accidental/dot glyph handles */}
        <DockTip name="Sharpshooter" desc="Drag handles to reshape slurs/ties and reposition accidentals and dots." keys="Tab">
          <Toggle
            pressed={isSharpshooterMode}
            onPressedChange={onSharpshooterModeChange}
            className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
          >
            <Crosshair className="h-3.5 w-3.5" />
          </Toggle>
        </DockTip>

        <div className="w-px h-5 bg-white/15" />

        {/* Erase */}
        <div className="relative">
          <DockTip name="Erase" keys="⌦" desc="Drag over notes to delete them.">
            <Toggle
              pressed={isDeleteMode}
              onPressedChange={onDeleteModeChange}
              className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-red-500/25 data-[state=on]:text-red-300'}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Toggle>
          </DockTip>
          {hasPendingRests && (
            <button
              onClick={onCollapseRests}
              title="Remove rests — collapse the red rests (Shift+Tab)"
              className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 flex h-6 w-6 items-center justify-center rounded-md bg-red-500/30 text-red-200 hover:bg-red-500/50 ring-1 ring-red-400/50 animate-in fade-in"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Broom — sweep away slurs, accidentals and dots */}
        <DockTip name="Broom" desc="Drag over slurs, accidentals, dots, key signatures, time signatures, or tempo markings to sweep them away (notes stay). " keys="B">
          <Toggle
            pressed={isBroomMode}
            onPressedChange={onBroomModeChange}
            className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-amber-500/25 data-[state=on]:text-amber-300'}
          >
            <Brush className="h-3.5 w-3.5" />
          </Toggle>
        </DockTip>
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

      {/* Auto-advance — keyboard placement cursor behaviour, its own bubble on the right */}
      <div className="inline-flex items-center px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
        <DockTip
          name="Auto-advance"
          desc="After placing a note with the keyboard, skip the cursor to the next beat. Turn off to stay on the note you just placed. Only works while you're locked onto a note (use the ← / → arrows to lock on)."
        >
          <Toggle
            pressed={advanceOnPlace}
            onPressedChange={onAdvanceOnPlaceChange}
            className={TOGGLE_ITEM_CLASS + ' data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
          >
            <StepForward className="h-3.5 w-3.5" />
          </Toggle>
        </DockTip>
        <DockTip
          name="Transposed parts"
          desc="Show each part in its written/transposed key (e.g. Bb trumpet up a tone). Turn off for concert pitch — all parts in the same key."
        >
          <Toggle
            pressed={transposedView}
            onPressedChange={onTransposedViewChange}
            className={TOGGLE_ITEM_CLASS + ' ml-1 data-[state=on]:bg-violet-500/25 data-[state=on]:text-violet-300'}
          >
            <Music2 className="h-3.5 w-3.5" />
          </Toggle>
        </DockTip>
      </div>
    </div>
  )
}

function keySigLabel(keySig: KeySig): string {
  const NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']
  const name = NAMES[(keySig.fifths + 7) % 15] ?? 'C'
  return `${name} ${keySig.mode === 'minor' ? 'm' : ''}`
}
