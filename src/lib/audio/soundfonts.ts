import * as Tone from 'tone'
import type { SoundFontStatus } from '../../types/audio'
import { getInstrument } from '../instruments'

const samplerCache = new Map<string, Tone.Sampler>()
const statusCache = new Map<string, SoundFontStatus>()

// Anchor samples spread across the full range. With only octave-4 samples,
// every other pitch is pitch-shifted by changing playbackRate, which also
// rescales the finite sample buffer's real-time length — so a whole-note chord
// would have its higher tones run out of buffer (and cut off) before its lower
// tones. Sampling every ~3 semitones across octaves 1–7 keeps the shift (and
// thus the audible decay) near-uniform, so chord tones release together.
// MusyngKite ships the full A0–C8 range for every instrument, so these all exist.
const SAMPLE_URLS: Record<string, string> = (() => {
  const anchors: [string, string][] = [['C', 'C'], ['D#', 'Eb'], ['F#', 'Gb'], ['A', 'A']]
  const urls: Record<string, string> = {}
  for (let octave = 1; octave <= 7; octave++) {
    for (const [note, file] of anchors) {
      urls[`${note}${octave}`] = `${file}${octave}.mp3`
    }
  }
  return urls
})()

// Loads a GeneralUser GS soundfont sampler for the given instrument key.
// Returns a promise that resolves when the sampler is ready.
export async function loadSoundFont(instrumentKey: string): Promise<Tone.Sampler> {
  if (samplerCache.has(instrumentKey)) {
    return samplerCache.get(instrumentKey)!
  }

  statusCache.set(instrumentKey, 'loading')
  const instrument = getInstrument(instrumentKey)

  return new Promise((resolve, reject) => {
    const sampler = new Tone.Sampler({
      urls: SAMPLE_URLS,
      release: 1,
      // Derive the sample directory from the instrument's known-good soundfont
      // URL (e.g. ".../acoustic_grand_piano-mp3.js" → ".../acoustic_grand_piano-mp3/").
      // Munging the instrument key instead produced wrong folders (piano → "piano-mp3").
      baseUrl: instrument.soundfontUrl.replace(/\.js$/, '/'),
      onload: () => {
        statusCache.set(instrumentKey, 'ready')
        samplerCache.set(instrumentKey, sampler)
        resolve(sampler)
      },
      onerror: (err: Error) => {
        statusCache.set(instrumentKey, 'error')
        reject(err)
      },
    }).toDestination()
  })
}

export function getSoundFontStatus(instrumentKey: string): SoundFontStatus {
  return statusCache.get(instrumentKey) ?? 'unloaded'
}
