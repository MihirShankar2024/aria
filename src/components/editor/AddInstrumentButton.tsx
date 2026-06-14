import { useState } from 'react'
import { Plus, Music } from 'lucide-react'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { INSTRUMENT_DB } from '../../lib/instruments'
import type { Clef } from '../../types/score'
import type { ScoreAction } from '../../state/actions'

// Instruments available to add (excluding the virtual piano_bass, which is added via ADD_PIANO_PART).
const ADD_INSTRUMENTS = Object.values(INSTRUMENT_DB).filter(i => i.key !== 'piano_bass')

interface AddInstrumentButtonProps {
  dispatch: (action: ScoreAction) => void
}

// Pill-styled "add instrument" control, matching the PlaybackBar pill so the two
// sit side by side at the bottom-left of the editor.
export function AddInstrumentButton({ dispatch }: AddInstrumentButtonProps) {
  const [open, setOpen] = useState(false)

  const handleAdd = (key: string) => {
    if (key === '__piano_grand__') {
      dispatch({ type: 'ADD_PIANO_PART' })
    } else {
      const inst = INSTRUMENT_DB[key]
      if (!inst) return
      dispatch({ type: 'ADD_PART', name: inst.displayName, instrument: key, clef: inst.clef as Clef })
    }
    setOpen(false)
  }

  return (
    <div className="inline-flex items-center gap-3 px-3 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10"
            title="Add instrument"
          >
            <Plus className="h-3.5 w-3.5 stroke-white" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-52 p-1 bg-zinc-900 border-white/15">
          <div className="text-[10px] px-2 py-1 text-white/40 uppercase tracking-wider font-semibold">Add instrument</div>
          <button
            onClick={() => handleAdd('__piano_grand__')}
            className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-md flex items-center gap-2"
          >
            <span className="text-base">🎹</span>
            Piano (Grand Staff)
          </button>
          <div className="h-px bg-white/10 my-1" />
          {ADD_INSTRUMENTS.map(inst => (
            <button
              key={inst.key}
              onClick={() => handleAdd(inst.key)}
              className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-md flex items-center gap-2"
            >
              <Music className="h-3.5 w-3.5 text-white/40" />
              {inst.displayName}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
