import type Anthropic from '@anthropic-ai/sdk'

/**
 * Contract for the stateless `/api/claude` relay. The client builds the full request (cacheable
 * system prompt, message history incl. tool_result blocks, tool defs) and runs the agent loop;
 * the relay just proxies `messages.create` and returns the raw content blocks.
 */
export interface AiRelayRequest {
  model?: string
  max_tokens?: number
  system?: Anthropic.Messages.TextBlockParam[] | string
  messages: Anthropic.Messages.MessageParam[]
  tools?: Anthropic.Messages.Tool[]
}

export interface AiRelayResponse {
  content: Anthropic.Messages.ContentBlock[]
  stop_reason: Anthropic.Messages.Message['stop_reason']
  usage: Anthropic.Messages.Usage
  model: string
}
