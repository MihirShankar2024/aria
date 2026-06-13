import type { ClaudeRequest, ClaudeResponse } from '../types/api'

export async function fetchClaude(request: ClaudeRequest): Promise<ClaudeResponse> {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Claude API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<ClaudeResponse>
}
