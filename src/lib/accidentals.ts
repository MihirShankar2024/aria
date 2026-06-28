import type { Pitch, NoteName, Measure, KeySig, Tie } from '../types/score'

// Standard order accidentals are added by a key signature.
const SHARP_ORDER: NoteName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER: NoteName[]  = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

// fifths → per-letter semitone offset implied by the key signature.
// e.g. D major (fifths 2) → { F: +1, C: +1 }.
export function keySigOffsets(fifths: number): Partial<Record<NoteName, number>> {
  const map: Partial<Record<NoteName, number>> = {}
  if (fifths > 0) for (let i = 0; i < fifths; i++) map[SHARP_ORDER[i]] = 1
  else for (let i = 0; i < -fifths; i++) map[FLAT_ORDER[i]] = -1
  return map
}

// Semitone offset of a written accidental. Natural cancels to 0.
export function explicitOffset(acc: Pitch['accidental']): number {
  switch (acc) {
    case 'double_sharp': return 2
    case 'sharp': return 1
    case 'natural': return 0
    case 'flat': return -1
    case 'double_flat': return -2
    default: return 0
  }
}

// Most recent keySig override at/before idx, else global. Mirrors the renderer's
// effectiveKeySigAt so resolution matches what's drawn.
export function effectiveKeySig(measures: Measure[], idx: number, global: KeySig): KeySig {
  for (let i = idx; i >= 0; i--) {
    if (measures[i]?.keySig) return measures[i].keySig!
  }
  return global
}

/**
 * Resolve every notehead's *sounding* accidental for a part, applying standard common-music
 * rules: an explicit accidental persists for that step+octave until the barline (carry) or until
 * explicitly cancelled with a natural; a tie continuation inherits its source's alteration across
 * the barline; everything else falls back to the key signature. Per the engraving spec, accidental
 * memory is per-measure AND per-voice (no leakage between voices), and a tie carry does NOT
 * establish memory for later notes.
 *
 * Returns the semitone `offset` (vs the natural pitch) per `Pitch.id`, so playback and the
 * serializer's MusicXML `<alter>` derive the same sounding pitch from one pass. This concerns
 * *sound* only: whether an accidental glyph is drawn is a separate presentational decision — we
 * always render what the user explicitly entered (even when redundant) for reading clarity.
 * Mirrors the algorithm that previously lived inline in audio/playback.ts.
 */
export function resolvePartAccidentals(measures: Measure[], ties: Tie[] | undefined, globalKeySig: KeySig): Map<string, number> {
  const out = new Map<string, number>()

  // Tie continuation (`to`) inherits the sounding pitch of its `from`, even across a
  // barline where the accidental isn't re-written. Matched below by pitch identity
  // (same letter + octave), so a slur to a different pitch inherits nothing.
  const tieFromOf = new Map<string, string>()
  for (const tie of ties ?? []) tieFromOf.set(tie.to.note, tie.from.note)
  // note id → resolved offset per `${step}${octave}`, used to carry across a genuine tie.
  const resolvedNoteOffsets = new Map<string, Map<string, number>>()

  for (let mIdx = 0; mIdx < measures.length; mIdx++) {
    const measure = measures[mIdx]
    if (!measure) continue
    const keyMap = keySigOffsets(effectiveKeySig(measures, mIdx, globalKeySig).fifths)

    for (const voice of [1, 2] as const) {
      const voiceNotes = measure.notes.filter(e => e.voice === voice)
      if (voiceNotes.length === 0) continue
      const measureAcc = new Map<string, number>()  // `${step}${octave}` → semitone offset

      for (const event of voiceNotes) {
        if (event.type !== 'note') continue
        const fromId = tieFromOf.get(event.id)
        const fromOffsets = fromId ? resolvedNoteOffsets.get(fromId) : undefined
        const offsets = new Map<string, number>()

        for (const pitch of event.pitches) {
          const memKey = `${pitch.step}${pitch.octave}`
          let offset: number
          if (pitch.accidental !== null) {
            offset = explicitOffset(pitch.accidental)
            measureAcc.set(memKey, offset)  // explicit always (re)establishes memory
          } else if (measureAcc.has(memKey)) {
            offset = measureAcc.get(memKey)!
          } else if (fromOffsets?.has(memKey)) {
            // Genuine tie continuation: carry the from-note's accidental. Per spec this
            // does NOT establish accidental memory for later notes, so don't set measureAcc.
            offset = fromOffsets.get(memKey)!
          } else {
            offset = keyMap[pitch.step] ?? 0
          }
          offsets.set(memKey, offset)
          out.set(pitch.id, offset)
        }
        resolvedNoteOffsets.set(event.id, offsets)
      }
    }
  }

  return out
}
