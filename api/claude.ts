/// <reference types="node" />
import Anthropic from '@anthropic-ai/sdk'

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ClaudeRequest { systemPrompt: string; userMessage: string; history: ChatMessage[] }

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response('ANTHROPIC_API_KEY not set', { status: 500 })
  }

  const { systemPrompt, userMessage, history } = (await req.json()) as ClaudeRequest

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
  return Response.json({ content })
}
