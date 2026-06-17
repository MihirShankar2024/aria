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

/** Prompt for how many measures to append (added to every track). */
export function AddMeasuresDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (count: number) => void
}) {
  const [value, setValue] = useState('4')

  // Reset to the default each time the dialog opens.
  useEffect(() => {
    if (open) setValue('4')
  }, [open])

  const count = Math.max(1, Math.min(64, Math.floor(Number(value) || 0)))
  const valid = Number(value) >= 1

  const submit = () => {
    if (!valid) return
    onConfirm(count)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-white/15 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add measures</DialogTitle>
          <DialogDescription className="text-white/50">
            How many measures to add? They're appended to every track so barlines stay aligned.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="number"
          min={1}
          max={64}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          autoFocus
          className="bg-white/5 border-white/15 text-white"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/70 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} className="bg-white/90 hover:bg-white text-black">
            Add{valid ? ` ${count}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
