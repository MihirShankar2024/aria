/// <reference types="node" />
import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ClaudeRequest { systemPrompt: string; userMessage: string; history: ChatMessage[] }

// Vercel Node runtime: the handler gets Node-style (req, res). The Anthropic SDK depends on
// node:fs/path (credential chain), so it cannot run on the Edge runtime — keep this on Node.
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

  // @vercel/node parses a JSON body into req.body; tolerate a raw string just in case.
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as ClaudeRequest
  const { systemPrompt, userMessage, history } = body

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ],
  })

  const content = response.content[0].type === 'text' ? response.content[0].text : ''
  res.status(200).json({ content })
}
