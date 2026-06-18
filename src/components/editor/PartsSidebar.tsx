import { Trash2, Music, Volume2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { INSTRUMENT_DB } from '../../lib/instruments'
import type { Part } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

interface PartsSidebarProps {
  parts: Part[]
  dispatch: (action: ScoreAction) => void
  volumes: Record<string, number>
  // Sets playback volume (gain 0–1) for the given part ids — a grand staff updates both.
  onVolumeChange: (partIds: string[], volume: number) => void
}

// A compact playback-volume row shared by single parts and grand staves.
function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1">
      <Volume2 className="h-3 w-3 text-white/30 flex-shrink-0" />
      <Slider
        value={[value]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
    </div>
  )
}

export function PartsSidebar({ parts, dispatch, volumes, onVolumeChange }: PartsSidebarProps) {
  // Group grand-staff pairs so we can render them together.
  const rendered = new Set<string>()
  const groups: Array<{ type: 'single'; part: Part } | { type: 'grand'; treble: Part; bass: Part }> = []

  for (const part of parts) {
    if (rendered.has(part.id)) continue
    if (part.grandStaffPartnerId) {
      const partner = parts.find(p => p.id === part.grandStaffPartnerId)
      if (partner) {
        rendered.add(part.id)
        rendered.add(partner.id)
        // Treble clef goes first.
        const treble = part.clef === 'treble' ? part : partner
        const bass   = part.clef === 'treble' ? partner : part
        groups.push({ type: 'grand', treble, bass })
        continue
      }
    }
    rendered.add(part.id)
    groups.push({ type: 'single', part })
  }

  const handleRemove = (partId: string) => {
    if (parts.length <= 1) return  // always keep at least one staff
    dispatch({ type: 'REMOVE_PART', partId })
  }

  const handleInstrumentChange = (partId: string, instrument: string) => {
    dispatch({ type: 'SET_PART_INSTRUMENT', partId, instrument })
  }

  return (
    <aside className="w-52 flex-shrink-0 border-r border-white/10 bg-black/20 flex flex-col">
      <div className="px-4 py-3 border-b border-white/10">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Instruments</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        {groups.map((group) =>
          group.type === 'grand' ? (
            <GrandStaffRow
              key={group.treble.id}
              treble={group.treble}
              bass={group.bass}
              canRemove={parts.length > 2}
              onRemove={() => handleRemove(group.treble.id)}
              onInstrumentChange={handleInstrumentChange}
              volume={volumes[group.treble.id] ?? 1}
              onVolumeChange={v => onVolumeChange([group.treble.id, group.bass.id], v)}
            />
          ) : (
            <PartRow
              key={group.part.id}
              part={group.part}
              canRemove={parts.length > 1}
              onRemove={() => handleRemove(group.part.id)}
              onInstrumentChange={handleInstrumentChange}
              volume={volumes[group.part.id] ?? 1}
              onVolumeChange={v => onVolumeChange([group.part.id], v)}
            />
          ),
        )}
      </div>
    </aside>
  )
}

function PartRow({
  part,
  canRemove,
  onRemove,
  onInstrumentChange,
  volume,
  onVolumeChange,
}: {
  part: Part
  canRemove: boolean
  onRemove: () => void
  onInstrumentChange: (partId: string, instrument: string) => void
  volume: number
  onVolumeChange: (volume: number) => void
}) {
  const availableInstruments = Object.values(INSTRUMENT_DB).filter(i => i.key !== 'piano_bass')

  return (
    <div className="px-2">
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 group">
        <Music className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Select value={part.instrument} onValueChange={v => onInstrumentChange(part.id, v)}>
            <SelectTrigger className="w-full min-w-0 h-auto p-0 border-0 bg-transparent! hover:bg-transparent! text-xs text-white/70 hover:text-white font-medium gap-1 focus:ring-0 shadow-none [&>svg]:hidden [&>span[data-slot=select-value]]:min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-white/15">
              {availableInstruments.map(inst => (
                <SelectItem key={inst.key} value={inst.key} className="text-xs text-white/80">
                  {inst.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            title="Remove staff"
            className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <VolumeSlider value={volume} onChange={onVolumeChange} />
    </div>
  )
}

function GrandStaffRow({
  canRemove,
  onRemove,
  volume,
  onVolumeChange,
}: {
  treble: Part
  bass: Part
  canRemove: boolean
  onRemove: () => void
  onInstrumentChange: (partId: string, instrument: string) => void
  volume: number
  onVolumeChange: (volume: number) => void
}) {
  return (
    <div className="px-2">
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 group">
        <span className="text-sm flex-shrink-0 leading-none">🎹</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white/70 font-medium truncate">Piano</div>
          <div className="text-[10px] text-white/35">Grand Staff</div>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            title="Remove piano"
            className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-white/40 hover:text-red-400 hover:bg-red-400/10 transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <VolumeSlider value={volume} onChange={onVolumeChange} />
    </div>
  )
}
