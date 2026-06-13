import { useState, useCallback } from 'react'
import type { Score } from '../types/score'
import type { AiSuggestion, ChatMessage } from '../types/api'
import { scoreToMusicXML } from '../lib/musicxml/serializer'
import { fetchClaude } from '../api/claude'

export function useAiPanel() {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null)

  const sendPrompt = useCallback(async (
    userMessage: string,
    score: Score,
    selectedPartIds: string[],
    selectedMeasureNumbers: number[],
  ) => {
    setError(null)
    setPending(true)

    const scoreSummary = scoreToMusicXML(score)
    const systemPrompt = `You are a professional music theory assistant embedded in a score editor.
The user has selected measures ${selectedMeasureNumbers.join(', ')} from parts: ${selectedPartIds.join(', ')}.
The full score (MusicXML 3.1) is:

${scoreSummary}

Respond with ONLY valid MusicXML 3.1 for the modified selected measures, followed by "---EXPLANATION---" and a brief musician-level explanation.
Do NOT include markdown fences or any other text outside this structure.`

    try {
      const response = await fetchClaude({ systemPrompt, userMessage, history })
      const [musicXMLPart, explanationPart] = response.content.split('---EXPLANATION---')

      setSuggestion({
        id: crypto.randomUUID(),
        requestText: userMessage,
        responseMusicXML: musicXMLPart?.trim() ?? '',
        explanation: explanationPart?.trim() ?? '',
        targetPartIds: selectedPartIds,
        targetMeasureNumbers: selectedMeasureNumbers,
        status: 'pending',
      })

      setHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.content },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }, [history])

  const discardSuggestion = useCallback(() => setSuggestion(null), [])

  return { history, pending, error, suggestion, sendPrompt, discardSuggestion }
}
