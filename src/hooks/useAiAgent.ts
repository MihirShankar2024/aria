import { useState, useCallback, useRef, useMemo } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import type { Score } from '../types/score'
import type { ScoreAction } from '../state/actions'
import { scoreReducer } from '../state/scoreReducer'
import { fetchClaude } from '../api/claude'
import { SYSTEM_PROMPT } from '../lib/ai/systemPrompt'
import { scoreForAi, projectMeasureById, type AiSelection } from '../lib/ai/serializeForAi'
import { AI_TOOLS } from '../lib/ai/tools'
import { executeToolCall } from '../lib/ai/executor'

const MODEL = 'claude-opus-4-8'
// Round-trips per prompt. Packed prompts (many edits + an analysis read) can need a lot of steps;
// too low silently truncates the work. Batching independent edits as parallel tool calls (taught in
// the system prompt) keeps this comfortable.
const MAX_ITERATIONS = 20

// Tool calls that change measure structure or meter. Executed before note-entry calls within a turn
// so capacity checks see the intended time signature / measure set (see the loop below).
const STRUCTURE_FIRST = new Set(['setTimeSig', 'setKeySig', 'addMeasures', 'insertMeasures', 'removeMeasures', 'addPart', 'addPianoPart'])

/** A pending in-chat question the model raised via the `askUser` tool. */
export interface PendingQuestion {
  text: string
  options: string[]
  multiSelect: boolean
}

/** One entry in the visible chat transcript. */
export interface UiTurn {
  id: string
  role: 'user' | 'assistant'
  text?: string
  status?: 'working' | 'done' | 'error'
  staged?: { actions: ScoreAction[] }       // edits proposed this turn, awaiting approve
  applied?: 'approved' | 'rejected'
  question?: PendingQuestion                 // shown as an inline QuestionBox
}

/**
 * Return a copy of `messages` with a rolling `cache_control` breakpoint on the last content block of
 * the most recent message. Combined with the breakpoint on the system block, this caches the entire
 * prefix within a prompt's tool loop — each iteration pays full price only for newly appended
 * tool_results. Keeps the canonical `messages` untagged so only two breakpoints exist (≤4 limit).
 */
function withRollingCache(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  if (messages.length === 0) return messages
  const out = messages.slice()
  const last = out[out.length - 1]
  const cc = { type: 'ephemeral' as const }
  if (typeof last.content === 'string') {
    out[out.length - 1] = { ...last, content: [{ type: 'text', text: last.content, cache_control: cc }] }
  } else {
    const blocks = last.content.slice()
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: cc } as Anthropic.Messages.ContentBlockParam
    out[out.length - 1] = { ...last, content: blocks }
  }
  return out
}

let uid = 0
const newTurnId = () => `t${uid++}`

/**
 * Client-orchestrated agent loop with a chat surface. Sends the native Score + prompt to Claude,
 * executes tool calls locally through `commands.*` (via the executor), and ACCUMULATES edits against
 * a working score copy (folded through the reducer) so multi-step edits + capacity stay correct;
 * nothing touches the live score until the user approves. The model can pause for a structured
 * answer via the `askUser` tool (rendered inline as a QuestionBox).
 */
export function useAiAgent(dispatchBatch: (actions: ScoreAction[]) => void) {
  const [turns, setTurns] = useState<UiTurn[]>([])
  // Mirror of `turns` for event handlers that must READ current turns without putting side effects
  // inside a setTurns updater (StrictMode double-invokes updaters → a dispatch there would fire twice).
  const turnsRef = useRef<UiTurn[]>([])
  turnsRef.current = turns
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheHit, setCacheHit] = useState<number | null>(null)

  const focusRef = useRef<number[] | undefined>(undefined)
  // Cross-prompt model memory: compact TEXT-only prior turns (prompt + final summary).
  const historyRef = useRef<Anthropic.Messages.MessageParam[]>([])
  const cancelledRef = useRef(false)
  // Resolver for the awaited askUser answer (set while a question is open).
  const answerResolverRef = useRef<((answer: string) => void) | null>(null)

  const patchTurn = useCallback((id: string, patch: Partial<UiTurn>) => {
    setTurns(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const send = useCallback(async (prompt: string, score: Score, selection: AiSelection, transposedView = false) => {
    setError(null)
    setPending(true)
    cancelledRef.current = false
    if (selection.measureNumbers.length) focusRef.current = selection.measureNumbers

    const asstId = newTurnId()
    setTurns(ts => [...ts, { id: newTurnId(), role: 'user', text: prompt }, { id: asstId, role: 'assistant', status: 'working' }])

    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]
    const messages: Anthropic.Messages.MessageParam[] = [
      ...historyRef.current,
      { role: 'user', content: `Current score (JSON):\n${scoreForAi(score, selection, { focusMeasures: focusRef.current, pitchDisplay: transposedView ? 'written' : 'concert' })}\n\nRequest: ${prompt}` },
    ]

    let working = score
    const stagedActions: ScoreAction[] = []
    let finalText = ''
    let lastStop: string | null = null

    // Park a promise the QuestionBox resolves; the loop awaits the user's answer.
    const ask = (q: PendingQuestion): Promise<string> => {
      patchTurn(asstId, { question: q, status: 'working' })
      return new Promise<string>(resolve => { answerResolverRef.current = resolve })
    }

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (cancelledRef.current) break
        const res = await fetchClaude({ model: MODEL, max_tokens: 8000, system, messages: withRollingCache(messages), tools: AI_TOOLS })
        setCacheHit(res.usage?.cache_read_input_tokens ?? null)
        lastStop = res.stop_reason
        messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.ContentBlockParam[] })

        const iterText = res.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
        if (iterText) finalText = iterText   // last non-empty text block = the wrap-up summary

        const toolResults: Anthropic.Messages.ContentBlockParam[] = []
        let stagedThisIter = false
        // Stage STRUCTURAL/meter calls before note-entry calls within a turn, so capacity is always
        // validated against the intended time signature (e.g. "setTimeSig(6,8) then fill" stays 6/8
        // even if the model emits the placeNote calls first). tool_results are keyed by id, so
        // reordering execution doesn't affect how results map back. Array.sort is stable, so same-rank
        // calls keep the model's original order. askUser stays last (it pauses the loop).
        const rank = (name: string) => (STRUCTURE_FIRST.has(name) ? 0 : name === 'askUser' ? 2 : 1)
        const orderedBlocks = res.content
          .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
          .sort((a, b) => rank(a.name) - rank(b.name))
        for (const block of orderedBlocks) {
          if (block.name === 'askUser') {
            const input = block.input as { question?: string; options?: string[]; multiSelect?: boolean }
            const answer = await ask({ text: input.question ?? 'Choose:', options: input.options ?? [], multiSelect: !!input.multiSelect })
            patchTurn(asstId, { question: undefined })
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: answer })
            continue
          }
          const outcome = executeToolCall(working, block.name, block.input as Record<string, unknown>)
          let resultForModel = outcome.result
          if (!outcome.isError && outcome.actions.length) {
            for (const a of outcome.actions) { working = scoreReducer(working, a); stagedActions.push(a) }
            stagedThisIter = true
            // Echo the touched bar's resulting content so the model SEES its own edit. The score
            // snapshot is sent only once (first user message); without this, a multi-turn edit sees
            // only terse {ok, placedId} results and re-places into bars it already filled (notes get
            // cloned, the second pass overflows into fresh measures). Note ids in the echo also let
            // later turns anchor markings/articulations/ties without re-reading.
            const inp = block.input as { partId?: string; measureId?: string }
            if (inp.partId && inp.measureId) {
              const measure = projectMeasureById(working, inp.partId, inp.measureId)
              if (measure) resultForModel = { ...(outcome.result as object), measure }
            }
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultForModel), is_error: outcome.isError })
        }

        // Stream progress into the turn as the model works: a fresh snapshot of the edits so far
        // (new identity → previewActions memo recomputes → the score repaints purple live) plus the
        // latest narration. Stays 'working' so the Accept/Cancel buttons don't show until we finish.
        if (stagedThisIter || iterText) {
          patchTurn(asstId, { staged: stagedActions.length ? { actions: [...stagedActions] } : undefined, text: finalText || undefined })
        }

        if (cancelledRef.current) break
        if (res.stop_reason === 'tool_use' && toolResults.length) {
          messages.push({ role: 'user', content: toolResults })
          continue
        }
        break
      }

      const stagedEdit = stagedActions.length ? { actions: stagedActions } : undefined
      patchTurn(asstId, { status: cancelledRef.current ? 'done' : 'done', text: finalText || (stagedEdit ? 'Made the requested edits.' : ''), staged: stagedEdit, question: undefined })

      if (lastStop === 'refusal') setError('Claude declined this request.')
      else if (lastStop === 'max_tokens') setError('The response was cut off (max tokens). Try a smaller request.')
      else if (lastStop === 'tool_use' && !cancelledRef.current) setError('Stopped early — needed more steps than allowed. Approve what’s staged, then ask me to continue.')

      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: prompt } as Anthropic.Messages.MessageParam,
        { role: 'assistant', content: finalText || '(made edits)' } as Anthropic.Messages.MessageParam,
      ].slice(-6)
    } catch (err) {
      patchTurn(asstId, { status: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' })
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      answerResolverRef.current = null
      setPending(false)
    }
  }, [patchTurn])

  /** Resolve the open question (from QuestionBox), continuing the loop. */
  const answerQuestion = useCallback((answer: string) => {
    answerResolverRef.current?.(answer)
    answerResolverRef.current = null
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    answerResolverRef.current?.('(cancelled)')   // unblock a parked question
    answerResolverRef.current = null
  }, [])

  const clearChat = useCallback(() => {
    historyRef.current = []
    focusRef.current = undefined
    setTurns([]); setError(null)
  }, [])

  const approve = useCallback((turnId: string) => {
    // Apply the batch HERE, in the handler body — never inside a setTurns updater. Updater fns must
    // be pure, and StrictMode double-invokes them, so a dispatchBatch there fires twice and the edits
    // land twice (same notes re-appended → clones). Read from turnsRef, guard against re-approve, then
    // mark the turn approved in a pure updater.
    const turn = turnsRef.current.find(t => t.id === turnId)
    if (!turn?.staged || turn.applied) return
    dispatchBatch(turn.staged.actions)
    setTurns(ts => ts.map(t => (t.id === turnId ? { ...t, applied: 'approved' } : t)))
  }, [dispatchBatch])

  const reject = useCallback((turnId: string) => {
    setTurns(ts => ts.map(t => (t.id === turnId ? { ...t, applied: 'rejected' } : t)))
  }, [])

  // The staged edits of the latest unresolved turn, surfaced so the editor can render them
  // optimistically (in purple) on the score until the user accepts/cancels. null = nothing pending.
  const previewActions = useMemo<ScoreAction[] | null>(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t.staged && !t.applied) return t.staged.actions
    }
    return null
  }, [turns])

  return { send, pending, error, turns, cacheHit, approve, reject, answerQuestion, cancel, clearChat, previewActions }
}
