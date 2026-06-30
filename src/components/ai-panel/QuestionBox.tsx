import { useState } from 'react'
import { cn } from '../../lib/utils'
import type { PendingQuestion } from '../../hooks/useAiAgent'

/**
 * Inline question raised by the model's `askUser` tool. Single-select → click an option to answer.
 * Multi-select → check options and Submit. Always offers a free-text "Other…" answer.
 */
export function QuestionBox({ question, onAnswer }: { question: PendingQuestion; onAnswer: (answer: string) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [other, setOther] = useState('')

  const submitMulti = () => {
    const parts = [...picked]
    if (other.trim()) parts.push(other.trim())
    if (parts.length) onAnswer(parts.join(', '))
  }
  const submitOther = () => { if (other.trim()) onAnswer(other.trim()) }

  return (
    <div className="mt-1.5 rounded-xl border border-violet-400/25 bg-violet-500/10 p-2.5">
      <div className="mb-2 text-[12.5px] text-white/85">{question.text}</div>

      <div className="flex flex-col gap-1.5">
        {question.options.map(opt => question.multiSelect ? (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12.5px] text-white/80 transition hover:border-violet-400/40">
            <input
              type="checkbox"
              checked={picked.has(opt)}
              onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(opt); else n.delete(opt); return n })}
              className="accent-violet-500"
            />
            {opt}
          </label>
        ) : (
          <button
            key={opt}
            onClick={() => onAnswer(opt)}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[12.5px] text-white/80 transition hover:border-violet-400/50 hover:bg-violet-500/20 hover:text-white"
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={other}
          onChange={e => setOther(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !question.multiSelect) submitOther() }}
          placeholder="Other…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[12.5px] text-white placeholder:text-white/30 outline-none focus:border-violet-400/50"
        />
        <button
          onClick={question.multiSelect ? submitMulti : submitOther}
          className={cn('rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
            (question.multiSelect ? (picked.size || other.trim()) : other.trim())
              ? 'bg-violet-500 text-white hover:bg-violet-400' : 'bg-white/10 text-white/30')}
        >
          {question.multiSelect ? 'Submit' : 'Send'}
        </button>
      </div>
    </div>
  )
}
