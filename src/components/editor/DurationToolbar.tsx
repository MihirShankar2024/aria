import { Toggle } from '../ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import type { Duration, Accidental } from '../../types/score'

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
}: DurationToolbarProps) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
      {/* Duration group */}
      <ToggleGroup
        type="single"
        value={selectedDuration}
        onValueChange={(v) => {
          if (v) onDurationChange(v as Duration)
        }}
        className="gap-0.5"
      >
        {DURATIONS.map(({ value, label, title }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            title={title}
            className={TOGGLE_ITEM_CLASS}
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="w-px h-5 bg-white/15" />

      {/* Modifiers */}
      <div className="flex gap-0.5">
        <Toggle
          pressed={isDotted}
          onPressedChange={onDottedChange}
          title="Dotted"
          className={TOGGLE_ITEM_CLASS}
        >
          ·
        </Toggle>
        <Toggle
          pressed={isRest}
          onPressedChange={onRestChange}
          title="Rest"
          className={TOGGLE_ITEM_CLASS + ' font-serif'}
        >
          𝄽
        </Toggle>
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
          <ToggleGroupItem
            key={value}
            value={value}
            title={title}
            className={TOGGLE_ITEM_CLASS + ' text-base'}
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="w-px h-5 bg-white/15" />

      {/* Tie / slur — one-shot: drag between two notes (T) */}
      <Toggle
        pressed={isTieMode}
        onPressedChange={onTieModeChange}
        title="Tie / slur — drag between two notes (T)"
        className={TOGGLE_ITEM_CLASS + ' text-base'}
      >
        ⌒
      </Toggle>

      <div className="w-px h-5 bg-white/15" />

      {/* Fill rests — one-shot: click a measure to pad it with rests */}
      <Toggle
        pressed={isFillMode}
        onPressedChange={onFillModeChange}
        title="Fill rests — click a measure to fill it"
        className={TOGGLE_ITEM_CLASS}
      >
        𝄽+
      </Toggle>
    </div>
  )
}
