export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ClaudeRequest {
  systemPrompt: string
  userMessage: string
  history: ChatMessage[]
}

export interface ClaudeResponse {
  content: string
}

export interface AiSuggestion {
  id: string
  requestText: string
  responseMusicXML: string   // raw MusicXML string from Claude
  explanation: string        // Claude's reasoning in plain text
  targetPartIds: string[]
  targetMeasureNumbers: number[]
  status: 'pending' | 'committed' | 'discarded'
}
