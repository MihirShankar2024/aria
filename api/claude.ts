/// <reference types="node" />
import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Stateless relay for the client-orchestrated agent loop. The score, reducer, and the editing
// command layer live in the browser, so tool EXECUTION happens client-side; this endpoint only
// proxies `messages.create` (the API key must stay server-side) and returns the raw content
// blocks (including `tool_use`) so the client can run its own loop.
//
// The client sends an already-shaped request: model, system (cacheable blocks), the full message
// history (incl. tool_result blocks), and the tool definitions. We forward verbatim and hand back
// content + stop_reason + usage. No server-side tool loop, no thinking (kept off for a simpler
// client loop — adaptive thinking can be added later with block echo-back).
interface RelayRequest {
  model?: string
  max_tokens?: number
  system?: Anthropic.Messages.TextBlockParam[] | string
  messages: Anthropic.Messages.MessageParam[]
  tools?: Anthropic.Messages.Tool[]
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed')
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).send('ANTHROPIC_API_KEY not set')
    return
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as RelayRequest
    const { model, max_tokens, system, messages, tools } = body

    const client = new Anthropic({ apiKey })
    // Stream + finalMessage (Tier-A): prevents HTTP timeouts on long adaptive-thinking turns. Adaptive
    // thinking improves hard musical reasoning; the client echoes thinking blocks back unchanged, so
    // multi-turn replay stays valid.
    const stream = client.messages.stream({
      model: model ?? 'claude-opus-4-8',
      max_tokens: max_tokens ?? 8000,
      thinking: { type: 'adaptive' },
      ...(system ? { system } : {}),
      ...(tools && tools.length ? { tools } : {}),
      messages,
    })
    const response = await stream.finalMessage()

    res.status(200).json({
      content: response.content,
      stop_reason: response.stop_reason,
      usage: response.usage,
      model: response.model,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
}
