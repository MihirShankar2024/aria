import { useState, useCallback, useRef } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import type { Score } from '../types/score'
import type { ScoreAction } from '../state/actions'
import { scoreReducer } from '../state/scoreReducer'
import { fetchClaude } from '../api/claude'
import { SYSTEM_PROMPT } from '../lib/ai/systemPrompt'
import { scoreForAi, type AiSelection } from '../lib/ai/serializeForAi'
import { AI_TOOLS, EDIT_TOOLS } from '../lib/ai/tools'
import { executeToolCall } from '../lib/ai/executor'

const MODEL = 'claude-opus-4-8'
// Round-trips per prompt. Packed prompts (many edits + an analysis read) can need a lot of steps;
// too low silently truncates the work. Batching independent edits as parallel tool calls (taught in
// the system prompt) keeps this comfortable.
const MAX_ITERATIONS = 20

/**
 * Return a copy of `messages` with a rolling `cache_control` breakpoint on the last content block of
 * the most recent message. Combined with the breakpoint on the system block, this caches the entire
 * prefix (tools + system + score + prior turns) within a prompt's tool loop — each iteration pays full
 * price only for the newly appended tool_results. `messages[0]` (the score) never changes within a
 * prompt, so it's cached from iteration 2 on. Keeps the canonical `messages` array untagged so only
 * two breakpoints exist at a time (≤4 limit).
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

export interface StagedEdit {
  actions: ScoreAction[]      // all edits the agent staged this turn (apply in order)
  summary: string[]           // human-readable per-tool summary lines
}

/**
 * Client-orchestrated agent loop. Sends the native Score + prompt to Claude, executes the tool
 * calls locally through `commands.*` (via the executor), and ACCUMULATES edits against a working
 * score copy (folded through the reducer) so multi-step edits and capacity checks stay correct.
 * Nothing touches the live score until the user approves the staged batch.
 */
export function useAiAgent(dispatchBatch: (actions: ScoreAction[]) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<string>('')
  const [staged, setStaged] = useState<StagedEdit | null>(null)
  const [cacheHit, setCacheHit] = useState<number | null>(null)
  // Where the conversation has been working, so a large-score focus window can default here when
  // nothing is selected (keeps the model's context near recent edits).
  const focusRef = useRef<number[] | undefined>(undefined)
  // Cross-prompt memory: compact TEXT-only prior turns (prompt + explanation), so follow-ups like
  // "now make that louder" resolve. We do NOT keep tool_use/tool_result blocks across prompts
  // (bulky + pairing-sensitive); the current score is re-sent each turn anyway.
  const historyRef = useRef<Anthropic.Messages.MessageParam[]>([])

  const send = useCallback(async (prompt: string, score: Score, selection: AiSelection) => {
    setPending(true)
    setError(null)
    setExplanation('')
    setStaged(null)
    if (selection.measureNumbers.length) focusRef.current = selection.measureNumbers

    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]
    const messages: Anthropic.Messages.MessageParam[] = [
      ...historyRef.current,
      { role: 'user', content: `Current score (JSON):\n${scoreForAi(score, selection, { focusMeasures: focusRef.current })}\n\nRequest: ${prompt}` },
    ]

    let working = score
    const stagedActions: ScoreAction[] = []
    const summary: string[] = []
    const texts: string[] = []
    let lastStop: string | null = null

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const res = await fetchClaude({ model: MODEL, max_tokens: 8000, system, messages: withRollingCache(messages), tools: AI_TOOLS })
        setCacheHit(res.usage?.cache_read_input_tokens ?? null)
        lastStop = res.stop_reason
        messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.ContentBlockParam[] })

        const toolResults: Anthropic.Messages.ContentBlockParam[] = []
        for (const block of res.content) {
          if (block.type === 'text') texts.push(block.text)
          else if (block.type === 'tool_use') {
            const outcome = executeToolCall(working, block.name, block.input as Record<string, unknown>)
            if (!outcome.isError && outcome.actions.length) {
              for (const a of outcome.actions) { working = scoreReducer(working, a); stagedActions.push(a) }
              if (EDIT_TOOLS.has(block.name)) summary.push(describeTool(block.name, block.input as Record<string, unknown>))
            }
            toolResults.push({
              type: 'tool_result', tool_use_id: block.id,
              content: JSON.stringify(outcome.result), is_error: outcome.isError,
            })
          }
        }

        if (res.stop_reason === 'tool_use' && toolResults.length) {
          messages.push({ role: 'user', content: toolResults })
          continue
        }
        break
      }

      const explanationText = texts.join('\n').trim()
      setExplanation(explanationText)
      setStaged(stagedActions.length ? { actions: stagedActions, summary } : null)

      // Robust stop reasons: surface refusal / truncation instead of silently showing nothing.
      // `lastStop === 'tool_use'` after the loop means we hit MAX_ITERATIONS while the model still
      // wanted to keep calling tools — the work is partial, so say so.
      if (lastStop === 'refusal') setError('Claude declined this request.')
      else if (lastStop === 'max_tokens') setError('The response was cut off (max tokens). Try a smaller or more specific request.')
      else if (lastStop === 'tool_use') setError('Stopped early — this request needed more steps than allowed. The edits so far are staged; approve them, then ask me to continue.')

      // Persist a compact text turn for cross-prompt memory (last ~3 exchanges).
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: prompt } as Anthropic.Messages.MessageParam,
        { role: 'assistant', content: explanationText || '(made edits)' } as Anthropic.Messages.MessageParam,
      ].slice(-6)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }, [])

  const clearChat = useCallback(() => {
    historyRef.current = []
    focusRef.current = undefined
    setStaged(null); setExplanation(''); setError(null)
  }, [])

  const approve = useCallback(() => {
    if (!staged) return
    dispatchBatch(staged.actions)   // one undo entry for the whole AI edit
    setStaged(null)
  }, [staged, dispatchBatch])

  const reject = useCallback(() => setStaged(null), [])

  return { send, pending, error, explanation, staged, cacheHit, approve, reject, clearChat }
}

function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'placeNote': { const p = input.pitch as { step: string; octave: number } | undefined; return `add ${input.duration} ${p ? p.step + p.octave : 'note'} (voice ${input.voice})` }
    case 'placeRest': return `add ${input.duration} rest (voice ${input.voice})`
    case 'replaceWithRest': return `replace with ${input.duration} rest`
    case 'addChordNote': { const p = input.pitch as { step: string; octave: number } | undefined; return `add ${p ? p.step + p.octave : 'tone'} to chord` }
    case 'removeChordNote': return 'remove chord tone'
    case 'deleteEvent': return 'delete event'
    case 'setEventVoice': return `move to voice ${input.toVoice}`
    case 'clearVoice': return `clear voice ${input.voice}`
    case 'addSlurOrTie': return 'add tie/slur'
    case 'removeTie': return 'remove tie/slur'
    case 'setArticulation': return `${input.on ? 'add' : 'remove'} ${input.articulation}`
    case 'addMarking': return `add marking ${input.symbolId ?? `"${input.text}"`}`
    case 'createTuplet': return `tuplet ${input.played}:${input.inSpaceOf}`
    case 'removeTuplet': return 'remove tuplet'
    case 'addMeasures': return `add ${input.count} measure(s)`
    case 'insertMeasures': return `insert ${input.count} measure(s) at ${input.at}`
    case 'removeMeasures': return `remove measures ${input.start}–${input.end}`
    case 'setTimeSig': return `time signature ${input.beats}/${input.beatType}${input.at ? ` at ${input.at}` : ''}`
    case 'setKeySig': return `key signature (${input.fifths} fifths, ${input.mode})`
    case 'setTempo': return `tempo ${input.tempo}`
    case 'setTitle': return `title "${input.title}"`
    case 'addPart': return `add part ${input.name}`
    case 'addPianoPart': return 'add piano part'
    case 'setPartInstrument': return 'change instrument'
    default: return name
  }
}
