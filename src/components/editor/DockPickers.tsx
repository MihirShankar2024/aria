import { useState, useRef, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover'
import type { Duration, Accidental, ArticulationType } from '../../types/score'

// Hover-opened dock pickers that fold a row of related options behind a single dock
// button, mirroring the PolyrhythmPicker: the button shows the current choice, hovering
// drops a panel below the dock with every option side by side plus a one-line description
// (which used to live as a per-button tooltip). Selecting an option closes the panel.

const DOCK_BTN_CLASS =
  'h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors'

/** Open/close timing shared by the hover panels — a small grace period lets the pointer
 *  travel from the dock button down into the panel without it closing underneath. */
function useHoverOpen() {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const scheduleClose = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 150) }
  const onEnter = () => { cancel(); setOpen(true) }
  return { open, setOpen, onEnter, scheduleClose, cancel }
}

/** A dock button whose hover reveals a panel of options laid out in a row, with a title
 *  and description footer. `trigger` is the always-visible button content. */
function HoverDockPanel({
  trigger,
  title,
  desc,
  children,
}: {
  trigger: ReactNode
  title: string
  desc: ReactNode
  children: ReactNode
}) {
  const { open, setOpen, onEnter, scheduleClose, cancel } = useHoverOpen()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex" onMouseEnter={onEnter} onMouseLeave={scheduleClose}>
          {trigger}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-auto bg-zinc-900 border-white/15 p-3"
        onOpenAutoFocus={e => e.preventDefault()}
        onMouseEnter={cancel}
        onMouseLeave={scheduleClose}
      >
        <div className="space-y-2.5">
          <div className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">{title}</div>
          <div className="flex items-stretch gap-1">{children}</div>
          <p className="text-[11px] leading-snug text-white/45">{desc}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One option tile in a hover panel: a glyph above its name, with an optional keybind chip. */
function OptionTile({
  glyph,
  name,
  keys,
  selected,
  glyphClass = '',
  onClick,
}: {
  glyph: ReactNode
  name: string
  keys?: string
  selected: boolean
  glyphClass?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-16 flex-col items-center gap-1 rounded-md px-2 py-2 transition-colors ${
        selected
          ? 'bg-violet-500/30 text-violet-200 ring-1 ring-violet-400/40'
          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className={`leading-none ${glyphClass}`}>{glyph}</span>
      <span className="text-[10px] font-medium leading-tight text-center">{name}</span>
      {keys && (
        <kbd className="rounded bg-white/10 px-1 py-px font-mono text-[9px] text-white/55">{keys}</kbd>
      )}
    </button>
  )
}

// ── Length ──────────────────────────────────────────────────────────────────

const LENGTHS: { value: Duration; name: string; keys: string }[] = [
  { value: 'whole', name: 'Whole', keys: 'W' },
  { value: 'half', name: 'Half', keys: 'H' },
  { value: 'quarter', name: 'Quarter', keys: 'Q' },
  { value: 'eighth', name: 'Eighth', keys: 'E / 8' },
  { value: 'sixteenth', name: 'Sixteenth', keys: 'X / 6' },
]

/** A note-value glyph drawn as SVG (the Musical-Symbol Unicode codepoints for whole/half
 *  render as tofu in system fonts). Inherits the surrounding text colour via currentColor. */
function NoteGlyph({ dur, className = '' }: { dur: Duration; className?: string }) {
  const filled = dur === 'quarter' || dur === 'eighth' || dur === 'sixteenth'
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <ellipse
        cx="8.5"
        cy="17"
        rx="4.4"
        ry="3.1"
        transform="rotate(-22 8.5 17)"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.5}
      />
      {dur !== 'whole' && <line x1="12.7" y1="16" x2="12.7" y2="4.5" stroke="currentColor" strokeWidth="1.4" />}
      {(dur === 'eighth' || dur === 'sixteenth') && (
        <path d="M12.7 4.5 C 16.5 6, 17.5 8.5, 15.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
      {dur === 'sixteenth' && (
        <path d="M12.7 8.2 C 16.5 9.7, 17.5 12.2, 15.5 14.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  )
}

interface LengthPickerProps {
  selected: Duration
  onChange: (d: Duration) => void
}

/** Single dock button reading `Length: <name>` that opens a row of note-value choices. */
export function LengthPicker({ selected, onChange }: LengthPickerProps) {
  const current = LENGTHS.find(l => l.value === selected) ?? LENGTHS[2]
  return (
    <HoverDockPanel
      title="Note length"
      desc="Adjusts note length."
      trigger={
        <button className={DOCK_BTN_CLASS + ' text-white/70 hover:text-white hover:bg-white/10 data-[state=open]:bg-white/10'}>
          <span className="text-white/45">Length:</span>
          <NoteGlyph dur={current.value} className="h-4 w-4 text-violet-300" />
        </button>
      }
    >
      {LENGTHS.map(({ value, name, keys }) => (
        <OptionTile
          key={value}
          glyph={<NoteGlyph dur={value} className="h-6 w-6" />}
          name={name}
          keys={keys}
          selected={value === selected}
          onClick={() => onChange(value)}
        />
      ))}
    </HoverDockPanel>
  )
}

// ── Accidentals ─────────────────────────────────────────────────────────────

const ACCIDENTALS: { value: NonNullable<Accidental>; glyph: string; name: string; keys?: string }[] = [
  { value: 'natural', glyph: '♮', name: 'Natural', keys: 'N' },
  { value: 'sharp', glyph: '♯', name: 'Sharp', keys: '♯' },
  { value: 'flat', glyph: '♭', name: 'Flat', keys: 'F' },
  { value: 'double_sharp', glyph: '𝄪', name: 'Double sharp' },
  { value: 'double_flat', glyph: '𝄫', name: 'Double flat' },
]

interface AccidentalPickerProps {
  selected: Accidental
  onChange: (a: Accidental) => void
}

/** Single dock button for accidentals that opens a row of choices. Clicking the active
 *  accidental again clears it (matching the old toggle-group deselect behaviour). */
export function AccidentalPicker({ selected, onChange }: AccidentalPickerProps) {
  const current = ACCIDENTALS.find(a => a.value === selected)
  return (
    <HoverDockPanel
      title="Accidental"
      desc="Place the following accidental on a new or existing note."
      trigger={
        <button
          onClick={() => { if (current) onChange(null) }}
          className={DOCK_BTN_CLASS + (current
          ? ' bg-violet-500/25 text-violet-200 hover:bg-violet-500/30'
          : ' text-white/70 hover:text-white hover:bg-white/10 data-[state=open]:bg-white/10')}>
          <span className={current ? 'text-violet-200/70' : 'text-white/45'}>Accidental:</span>
          {current
            ? <span className="text-violet-200 text-base leading-none">{current.glyph}</span>
            : <span className="text-white/45">None</span>}
        </button>
      }
    >
      {ACCIDENTALS.map(({ value, glyph, name, keys }) => (
        <OptionTile
          key={value}
          glyph={glyph}
          glyphClass="text-xl"
          name={name}
          keys={keys}
          selected={value === selected}
          onClick={() => onChange(value === selected ? null : value)}
        />
      ))}
    </HoverDockPanel>
  )
}

// ── Articulations ───────────────────────────────────────────────────────────

// Each glyph is the Bravura/SMuFL codepoint for the "above" variant, so the palette preview
// matches the engraved mark (see ARTICULATION_GLYPHS in renderer.ts). `common` marks the five
// frequent articulations shown as larger tiles; the rest are smaller string techniques.
const ARTICULATIONS: { value: ArticulationType; glyph: string; name: string; keys?: string; common: boolean }[] = [
  { value: 'staccato', glyph: '', name: 'Staccato', keys: '.', common: true },
  { value: 'tenuto', glyph: '', name: 'Tenuto', keys: '-', common: true },
  { value: 'fermata', glyph: '', name: 'Fermata', keys: '~', common: true },
  { value: 'accent', glyph: '', name: 'Accent', keys: '>', common: true },
  { value: 'marcato', glyph: '', name: 'Marcato', keys: '^', common: true },
  { value: 'spiccato', glyph: '', name: 'Spiccato', common: false },
  { value: 'upBow', glyph: '', name: 'Up bow', common: false },
  { value: 'downBow', glyph: '', name: 'Down bow', common: false },
  { value: 'lhPizz', glyph: '', name: 'L.H. pizz', common: false },
  { value: 'snapPizz', glyph: '', name: 'Snap pizz', common: false },
  { value: 'open', glyph: '', name: 'Open', common: false },
]

interface ArticulationPickerProps {
  selected: ArticulationType | null
  onChange: (a: ArticulationType | null) => void
}

/** Single dock button for articulations. Hovering reveals the five common marks as larger
 *  tiles above a row of smaller string techniques. Like accidentals, clicking the active mark
 *  clears it; unlike accidentals the selection is sticky and persists after placing notes. */
export function ArticulationPicker({ selected, onChange }: ArticulationPickerProps) {
  const current = ARTICULATIONS.find(a => a.value === selected)
  const common = ARTICULATIONS.filter(a => a.common)
  const strings = ARTICULATIONS.filter(a => !a.common)
  const tile = (a: typeof ARTICULATIONS[number]) => (
    <OptionTile
      key={a.value}
      glyph={<span style={{ fontFamily: 'Bravura, serif' }}>{a.glyph}</span>}
      glyphClass="text-2xl"
      name={a.name}
      keys={a.keys}
      selected={a.value === selected}
      onClick={() => onChange(a.value === selected ? null : a.value)}
    />
  )
  return (
    <HoverDockPanel
      title="Articulation"
      desc="Place the following articulation on a new or existing note/chord. Stays selected until you turn it off."
      trigger={
        <button
          onClick={() => { if (current) onChange(null) }}
          className={DOCK_BTN_CLASS + (current
          ? ' bg-violet-500/25 text-violet-200 hover:bg-violet-500/30'
          : ' text-white/70 hover:text-white hover:bg-white/10 data-[state=open]:bg-white/10')}>
          <span className={current ? 'text-violet-200/70' : 'text-white/45'}>Articulations:</span>
          {current
            ? <span className="text-violet-200 text-base leading-none" style={{ fontFamily: 'Bravura, serif' }}>{current.glyph}</span>
            : <span className="text-white/45">None</span>}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-stretch gap-1">{common.map(tile)}</div>
        <div className="flex items-stretch gap-1 [&_button]:w-14 [&_button]:py-1.5">{strings.map(tile)}</div>
      </div>
    </HoverDockPanel>
  )
}
