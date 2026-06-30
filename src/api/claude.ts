import type { AiRelayRequest, AiRelayResponse } from '../types/api'

/** POST one turn to the relay. The caller owns the agent loop (tool execution + re-posting). */
export async function fetchClaude(request: AiRelayRequest): Promise<AiRelayResponse> {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Claude API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<AiRelayResponse>
}
