import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/** "Are you sure?" confirmation before removing an instrument/track. */
export function RemoveTrackDialog({
  trackName,
  open,
  onOpenChange,
  onConfirm,
}: {
  trackName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-white/15 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove {trackName ?? 'instrument'}?</DialogTitle>
          <DialogDescription className="text-white/50">
            This deletes the staff and all of its notes. This can be undone with ⌘Z.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/70 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
          <Button
            onClick={() => { onConfirm(); onOpenChange(false) }}
            className="bg-red-500/90 hover:bg-red-500 text-white"
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const fieldClass = 'bg-white/5 border-white/15 text-white'
const numberInput = 'h-8 w-20 rounded-md border bg-white/5 border-white/15 px-2 text-sm text-white text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

/**
 * Add or remove measures across every track (so barlines stay aligned). Supports
 * appending to the end, inserting before a given measure, and removing a measure range.
 */
export function MeasuresDialog({
  open,
  onOpenChange,
  measureCount,
  onAppend,
  onInsert,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  measureCount: number
  onAppend: (count: number) => void
  onInsert: (count: number, at: number) => void
  onRemove: (start: number, end: number) => void
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [count, setCount] = useState('4')
  const [atEnd, setAtEnd] = useState(true)
  const [at, setAt] = useState('1')
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState('1')

  // Reset to sensible defaults each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setMode('add')
    setCount('4')
    setAtEnd(true)
    setAt('1')
    setStart('1')
    setEnd(String(Math.max(1, measureCount)))
  }, [open, measureCount])

  const num = (v: string) => Math.floor(Number(v) || 0)
  const addCount = Math.max(1, Math.min(64, num(count)))
  const addAt = Math.max(1, Math.min(measureCount, num(at)))
  const remStart = Math.max(1, Math.min(measureCount, num(start)))
  const remEnd = Math.max(1, Math.min(measureCount, num(end)))

  const addValid = num(count) >= 1 && (atEnd || num(at) >= 1)
  const remValid = measureCount > 1 && remEnd >= remStart && (remEnd - remStart + 1) < measureCount
  const valid = mode === 'add' ? addValid : remValid

  const submit = () => {
    if (!valid) return
    if (mode === 'add') {
      if (atEnd) onAppend(addCount)
      else onInsert(addCount, addAt)
    } else {
      onRemove(remStart, remEnd)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-white/15 text-white sm:max-w-sm" onKeyDown={e => { if (e.key === 'Enter') submit() }}>
        <DialogHeader>
          <DialogTitle>Add or remove measures</DialogTitle>
          <DialogDescription className="text-white/50">
            Changes apply to every track so barlines stay aligned.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex rounded-md border border-white/15 p-0.5 text-sm">
          {(['add', 'remove'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded py-1 capitalize transition ${
                mode === m ? 'bg-white/90 text-black' : 'text-white/60 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'add' ? (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm text-white/70">
              <span>How many?</span>
              <Input
                type="number"
                min={1}
                max={64}
                value={count}
                onChange={e => setCount(e.target.value)}
                autoFocus
                className={`h-8 w-20 text-center ${fieldClass}`}
              />
            </label>
            <div className="space-y-2 text-sm text-white/70">
              <label className="flex items-center gap-2">
                <input type="radio" checked={atEnd} onChange={() => setAtEnd(true)} className="accent-white" />
                <span>Append to the end</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!atEnd} onChange={() => setAtEnd(false)} className="accent-white" />
                <span>Insert before measure</span>
                <input
                  type="number"
                  min={1}
                  max={measureCount}
                  value={at}
                  onFocus={() => setAtEnd(false)}
                  onChange={e => setAt(e.target.value)}
                  className={numberInput}
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-white/70">
            <p className="text-white/45">Score has {measureCount} measure{measureCount === 1 ? '' : 's'}. Remove an inclusive range:</p>
            <div className="flex items-center gap-2">
              <span>From measure</span>
              <input
                type="number"
                min={1}
                max={measureCount}
                value={start}
                onChange={e => setStart(e.target.value)}
                className={numberInput}
              />
              <span>to</span>
              <input
                type="number"
                min={1}
                max={measureCount}
                value={end}
                onChange={e => setEnd(e.target.value)}
                className={numberInput}
              />
            </div>
            {!remValid && measureCount > 1 && (
              <p className="text-red-400/80">Can't remove every measure.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/70 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid}
            className={mode === 'remove'
              ? 'bg-red-500/90 hover:bg-red-500 text-white'
              : 'bg-white/90 hover:bg-white text-black'}
          >
            {mode === 'add'
              ? `Add ${addValid ? addCount : ''}`.trim()
              : `Remove ${remValid ? remEnd - remStart + 1 : ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
