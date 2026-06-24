import type { LineAnnotationType, TextAnnotationStyle } from '../../types/score'

/**
 * Single source of truth for the Annotations panel. Every glyph is a real SMuFL codepoint
 * from VexFlow's `Glyphs` enum (Bravura), so the marks match standard engraving. Codepoints
 * are written as numeric SMuFL values (PUA, U+Exxx) and assembled with `cp()` so the source
 * stays free of literal private-use characters. Line-based marks (hairpins, 8va, endings,
 * pedal, gliss) carry a `lineType` and are drawn as SVG, not glyphs. Text entries seed an
 * editable, restyleable text box.
 */

export type SpawnKind = 'glyph' | 'line' | 'text'

export interface CatalogEntry {
  symbolId: string
  label: string                 // tooltip / aria label
  spawn: SpawnKind
  glyph?: string                // SMuFL string for spawn:'glyph' (and panel preview)
  scale?: number                // glyph size multiplier (default 1)
  lineType?: LineAnnotationType // for spawn:'line'
  preview?: string              // panel cell preview for line entries
  text?: string                 // seed text for spawn:'text'
  textStyle?: TextAnnotationStyle
  previewFont: 'bravura' | 'text'  // how the panel cell renders this entry
  previewScale?: number            // shrink an oversized glyph so it fits its panel cell
}

export interface CatalogCategory {
  id: string
  name: string
  entries: CatalogEntry[]
}

/** Assemble a glyph string from one or more SMuFL codepoints. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes)

// SMuFL dynamic letter glyphs (Bravura), keyed by the letter used in dynamic tokens.
// Composed letter-by-letter exactly like VexFlow's TextDynamics.
const DYN: Record<string, number> = {
  p: 0xe520, // dynamicPiano
  f: 0xe522, // dynamicForte
  m: 0xe521, // dynamicMezzo
  s: 0xe524, // dynamicSforzando
  z: 0xe525, // dynamicZ
  r: 0xe523, // dynamicRinforzando
  n: 0xe526, // dynamicNiente
}

function composeDynamic(token: string): string {
  return token
    .split('')
    .map(ch => (ch in DYN ? cp(DYN[ch]) : ch))
    .join('')
}

function dyn(token: string): CatalogEntry {
  return {
    symbolId: `dyn.${token}`,
    label: token,
    spawn: 'glyph',
    glyph: composeDynamic(token),
    previewFont: 'bravura',
  }
}

function glyph(symbolId: string, label: string, code: number, scale = 1): CatalogEntry {
  return { symbolId, label, spawn: 'glyph', glyph: cp(code), scale, previewFont: 'bravura' }
}

function line(symbolId: string, label: string, lineType: LineAnnotationType, preview: string): CatalogEntry {
  return { symbolId, label, spawn: 'line', lineType, preview, previewFont: 'text' }
}

const TEXT_BASE: TextAnnotationStyle = { fontFamily: 'serif', fontSize: 16, bold: false, italic: false }

function text(symbolId: string, label: string, seed: string, style: Partial<TextAnnotationStyle>): CatalogEntry {
  return {
    symbolId,
    label,
    spawn: 'text',
    text: seed,
    textStyle: { ...TEXT_BASE, ...style },
    preview: seed,
    previewFont: 'text',
  }
}

export const ANNOTATION_CATALOG: CatalogCategory[] = [
  {
    id: 'dynamics',
    name: 'Dynamics',
    entries: [
      'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fffff',
      'fp', 'sf', 'sfz', 'sfzp', 'sffz', 'fz', 'rf', 'rfz', 'n',
    ].map(dyn),
  },
  {
    id: 'ornaments',
    name: 'Ornaments',
    entries: [
      glyph('orn.trill', 'Trill', 0xe566),               // ornamentTrill
      line('orn.trillExt', 'Trill + extension', 'trillExt', 'tr~~'),
      glyph('orn.mordent', 'Mordent', 0xe56d),           // ornamentMordent
      glyph('orn.mordentInv', 'Inverted mordent', 0xe56c), // ornamentShortTrill
      glyph('orn.turn', 'Turn', 0xe567),                 // ornamentTurn
      glyph('orn.turnInv', 'Inverted turn', 0xe568),     // ornamentTurnInverted
      { ...glyph('orn.arpeggio', 'Arpeggio', 0xe63c), previewScale: 0.6 }, // arpeggiato — tall glyph, shrink in panel
      glyph('orn.grace', 'Grace note (acciaccatura)', 0xe560), // graceNoteAcciaccaturaStemUp
      glyph('orn.appoggiatura', 'Appoggiatura', 0xe562), // graceNoteAppoggiaturaStemUp
      glyph('orn.tremolo1', 'Tremolo (1)', 0xe220),
      glyph('orn.tremolo2', 'Tremolo (2)', 0xe221),
      glyph('orn.tremolo3', 'Tremolo (3)', 0xe222),
      glyph('orn.accSharp', 'Sharp (over ornament)', 0xe262, 0.6),
      glyph('orn.accFlat', 'Flat (over ornament)', 0xe260, 0.6),
      glyph('orn.accNatural', 'Natural (over ornament)', 0xe261, 0.6),
      line('orn.gliss', 'Glissando', 'gliss', '╱'),
    ],
  },
  {
    id: 'symbols',
    name: 'Symbols',
    entries: [
      line('sym.cresc', 'Crescendo', 'cresc', '<'),
      line('sym.decresc', 'Decrescendo', 'decresc', '>'),
      line('sym.8va', '8va', 'ottava8va', '8va'),
      line('sym.8vb', '8vb', 'ottava8vb', '8vb'),
      line('sym.ending1', '1st ending', 'ending1', '⎐1'),
      line('sym.ending2', '2nd ending', 'ending2', '⎐2'),
      line('sym.pedalBracket', 'Pedal bracket', 'pedalBracket', '⌐⌐'),
      glyph('sym.repeatBegin', 'Repeat begin', 0xe040), // repeatLeft
      glyph('sym.repeatEnd', 'Repeat end', 0xe041),     // repeatRight
      glyph('sym.simile', 'Simile', 0xe500),            // repeat1Bar
      glyph('sym.segno', 'Segno', 0xe047),
      glyph('sym.coda', 'Coda', 0xe048),
      glyph('sym.pedalPed', 'Engage pedal', 0xe650),    // keyboardPedalPed
      glyph('sym.pedalUp', 'Release pedal', 0xe655),    // keyboardPedalUp
      text('sym.ds', 'Dal Segno (D.S.)', 'D.S.', { italic: true }),
      text('sym.dc', 'Da Capo (D.C.)', 'D.C.', { italic: true }),
    ],
  },
  {
    id: 'text',
    name: 'Text',
    entries: [
      text('text.plain', 'Plain text', 'text', {}),
      text('text.expr', 'Expression (italic)', 'espressivo', { italic: true }),
      text('text.heading', 'Heading (bold)', 'Heading', { bold: true, fontSize: 22 }),
      text('text.tempo', 'Tempo', 'Allegro', { bold: true, fontSize: 18 }),
    ],
  },
]

/** Lookup an entry by its catalog symbolId (used when re-rendering placed annotations). */
export function findCatalogEntry(symbolId: string): CatalogEntry | undefined {
  for (const cat of ANNOTATION_CATALOG) {
    const found = cat.entries.find(e => e.symbolId === symbolId)
    if (found) return found
  }
  return undefined
}
