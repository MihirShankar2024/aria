import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, ArrowUp, X, Loader2, Check, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface AiPromptBoxProps {
  onSubmit: (prompt: string) => void | Promise<void>
  pending?: boolean
  error?: string | null
  explanation?: string
  /** Staged edit summary lines, present when the agent has proposed changes awaiting approval. */
  staged?: { summary: string[] } | null
  onApprove?: () => void
  onReject?: () => void
  onClearChat?: () => void
  className?: string
}

/**
 * Floating AI prompt box (bottom-right). Type an instruction → the agent proposes edits → the
 * staged diff is shown with Approve / Reject (propose→approve gate). Nothing touches the score
 * until you approve.
 */
export function AiPromptBox({ onSubmit, pending = false, error, explanation, staged, onApprove, onReject, onClearChat, className }: AiPromptBoxProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (open) taRef.current?.focus() }, [open])
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [value, open])

  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || pending) return
    setValue('')
    await onSubmit(prompt)
  }

  return (
    <div className={cn('fixed bottom-5 right-5 z-50 flex flex-col items-end', className)}>
      <AnimatePresence mode="popLayout">
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="w-[360px] rounded-2xl border border-white/12 bg-white/[0.06] p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-white/45">
                <Sparkles className="h-3 w-3 text-violet-400" />
                Ask Aria
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={onClearChat} title="New chat" className="flex h-5 w-5 items-center justify-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white">
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button onClick={() => setOpen(false)} title="Close" className="flex h-5 w-5 items-center justify-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 transition focus-within:border-violet-400/50">
              <textarea
                ref={taRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                  if (e.key === 'Escape') setOpen(false)
                }}
                rows={1}
                placeholder="Describe a change — e.g. “add a C major chord in bar 1”"
                className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <span className="px-1 text-[10px] text-white/30">⏎ send · ⇧⏎ newline</span>
                <button
                  onClick={submit}
                  disabled={!value.trim() || pending}
                  title="Send"
                  className={cn('flex h-7 w-7 items-center justify-center rounded-lg transition',
                    value.trim() && !pending ? 'bg-violet-500 text-white hover:bg-violet-400' : 'bg-white/10 text-white/30')}
                >
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {error && <p className="px-2.5 pt-2 text-[12px] text-red-300/80">{error}</p>}

            {explanation && (
              <p className="px-2.5 pt-2 text-[12px] leading-relaxed text-white/60">{explanation}</p>
            )}

            <AnimatePresence>
              {staged && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.07] p-2.5">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-violet-300/70">Proposed changes</div>
                    <ul className="space-y-0.5">
                      {staged.summary.map((line, i) => (
                        <li key={i} className="text-[12px] text-white/70">• {line}</li>
                      ))}
                      {staged.summary.length === 0 && <li className="text-[12px] text-white/40">(no visible edits)</li>}
                    </ul>
                    <div className="mt-2.5 flex gap-2">
                      <button onClick={onApprove} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-500 py-1.5 text-[12px] font-medium text-white transition hover:bg-violet-400">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button onClick={onReject} className="flex-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-[12px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
                        Reject
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.button
            key="fab"
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] py-2.5 pl-3 pr-4 text-sm font-medium text-white/80 shadow-xl shadow-black/30 backdrop-blur-xl transition hover:border-violet-400/40 hover:text-white"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/90">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </span>
            Ask Aria
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
