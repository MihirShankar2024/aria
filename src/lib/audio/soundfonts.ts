import * as Tone from 'tone'
import type { SoundFontStatus } from '../../types/audio'
import { getInstrument } from '../instruments'

const samplerCache = new Map<string, Tone.Sampler>()
const statusCache = new Map<string, SoundFontStatus>()

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
      urls: { C4: 'C4.mp3', 'D#4': 'Eb4.mp3', 'F#4': 'Gb4.mp3', A4: 'A4.mp3' },
      release: 1,
      baseUrl: `https://gleitz.github.io/midi-js-soundfonts/MusyngKite/${instrument.key.replace('_bb', '').replace('_', '-')}-mp3/`,
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
