import type { Score, Part, Measure, NoteEvent, TimeSig, KeySig } from '../types/score'

export function getPart(score: Score, partId: string): Part | undefined {
  return score.parts.find(p => p.id === partId)
}

export function getMeasure(score: Score, partId: string, measureId: string): Measure | undefined {
  return getPart(score, partId)?.measures.find(m => m.id === measureId)
}

export function getMeasureByNumber(score: Score, partId: string, num: number): Measure | undefined {
  return getPart(score, partId)?.measures.find(m => m.number === num)
}

export function getEffectiveTimeSig(score: Score, partId: string, measureId: string): TimeSig {
  const measure = getMeasure(score, partId, measureId)
  return measure?.timeSig ?? score.globalTimeSig
}

export function getEffectiveKeySig(score: Score, partId: string, measureId: string): KeySig {
  const measure = getMeasure(score, partId, measureId)
  return measure?.keySig ?? score.globalKeySig
}

export function getNotesInRange(
  score: Score,
  partId: string,
  startMeasure: number,
  endMeasure: number,
): NoteEvent[] {
  const part = getPart(score, partId)
  if (!part) return []
  return part.measures
    .filter(m => m.number >= startMeasure && m.number <= endMeasure)
    .flatMap(m => m.notes)
}

export function getMeasureCount(score: Score): number {
  return Math.max(0, ...score.parts.map(p => p.measures.length))
}
