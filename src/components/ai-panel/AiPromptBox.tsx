import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, ArrowUp, X, Loader2, Check, RotateCcw, Square } from 'lucide-react'
import { cn } from '../../lib/utils'
import { QuestionBox } from './QuestionBox'
import type { UiTurn } from '../../hooks/useAiAgent'

export interface AiPromptBoxProps {
  turns: UiTurn[]
  onSubmit: (prompt: string) => void | Promise<void>
  pending?: boolean
  error?: string | null
  onApprove?: (turnId: string) => void
  onReject?: (turnId: string) => void
  onAnswer?: (answer: string) => void
  onCancel?: () => void
  onClearChat?: () => void
  className?: string
}

/**
 * Floating chat panel for Aria (bottom-right). Shows the full transcript, an inline staged-diff
 * Approve/Reject, and inline question boxes from the askUser tool. Opaque violet background so it
 * stays readable over white staff backgrounds. Collapses to the "Ask Aria" pill.
 */
export function AiPromptBox({ turns, onSubmit, pending = false, error, onApprove, onReject, onAnswer, onCancel, onClearChat, className }: AiPromptBoxProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const hasOpenQuestion = turns.some(t => t.question)

  useEffect(() => { if (open) taRef.current?.focus() }, [open])
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [value, open])
  // Auto-scroll to the latest turn.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [turns])

  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || pending) return
    setValue('')
    await onSubmit(prompt)
  }

  // Opaque dark-violet surface — readable over white staves behind it.
  const surface = 'border border-violet-400/15 bg-[#160a26]/95 backdrop-blur-xl shadow-2xl shadow-black/50'

  return (
    <div className={cn('fixed bottom-5 right-5 z-50 flex flex-col items-end', className)}>
      <AnimatePresence mode="popLayout">
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn('flex w-[380px] flex-col overflow-hidden rounded-2xl', surface)}
            style={{ height: 'min(50vh, 560px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-white/55">
                <Sparkles className="h-3 w-3 text-violet-400" /> Ask Aria
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

            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {turns.length === 0 && (
                <div className="mt-6 text-center text-[12.5px] text-white/35">
                  Describe a change — e.g. “add a C major chord in bar 1”.
                </div>
              )}
              {turns.map(t => t.role === 'user' ? (
                <div key={t.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-violet-500/85 px-3 py-1.5 text-[12.5px] text-white">{t.text}</div>
                </div>
              ) : (
                <div key={t.id} className="flex flex-col gap-1.5">
                  {t.status === 'working' && !t.question && (
                    <div className="flex items-center gap-2 text-[12.5px] text-white/45">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aria is working…
                      {onCancel && <button onClick={onCancel} title="Stop" className="ml-1 flex items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[11px] text-white/55 hover:text-white"><Square className="h-2.5 w-2.5" /> Stop</button>}
                    </div>
                  )}
                  {t.text && <div className="text-[12.5px] leading-relaxed text-white/80">{t.text}</div>}
                  {t.status === 'error' && !t.text && <div className="text-[12.5px] text-red-300/80">Something went wrong.</div>}

                  {t.question && onAnswer && <QuestionBox question={t.question} onAnswer={onAnswer} />}

                  {t.staged && !t.applied && t.status !== 'working' && (
                    <div className="mt-1 flex gap-2">
                      <button onClick={() => onApprove?.(t.id)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-500 py-1.5 text-[12px] font-medium text-white transition hover:bg-violet-400">
                        <Check className="h-3.5 w-3.5" /> Accept
                      </button>
                      <button onClick={() => onReject?.(t.id)} className="flex-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-[12px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
                        Cancel
                      </button>
                    </div>
                  )}
                  {t.applied && <div className={cn('text-[11px] font-medium', t.applied === 'approved' ? 'text-violet-300/80' : 'text-white/35')}>{t.applied === 'approved' ? '✓ Applied' : 'Discarded'}</div>}
                </div>
              ))}
            </div>

            {error && <div className="border-t border-white/10 px-3 py-1.5 text-[11.5px] text-red-300/80">{error}</div>}

            {/* Input */}
            <div className="border-t border-white/10 p-2">
              <div className="rounded-xl border border-white/10 bg-black/25 transition focus-within:border-violet-400/50">
                <textarea
                  ref={taRef}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                  }}
                  rows={1}
                  placeholder={hasOpenQuestion ? 'Answer above, or type…' : 'Describe a change…'}
                  className="block w-full resize-none bg-transparent px-3 py-2 text-[13px] text-white placeholder:text-white/30 outline-none"
                />
                <div className="flex items-center justify-between px-2 pb-1.5">
                  <span className="px-1 text-[10px] text-white/25">⏎ send · ⇧⏎ newline</span>
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
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="fab"
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => setOpen(true)}
            className={cn('flex items-center gap-2 rounded-full py-2.5 pl-3 pr-4 text-sm font-medium text-white/85 transition hover:text-white', surface)}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </span>
            Ask Aria
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
