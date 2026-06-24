import type { Annotation } from '../../types/score'
import type { CatalogEntry } from '../../lib/annotations/catalog'
import { defaultLineEnd } from '../../lib/annotations/lineShapes'

/**
 * Build a concrete Annotation from a chosen catalog entry at a measure-anchored position.
 * Glyph/text marks land at the click; line marks get a sensible default span/angle (see
 * `defaultLineEnd`) the user then stretches. Returns the new annotation and, for text marks,
 * signals it should mount in edit mode.
 */
export function buildAnnotation(
  entry: CatalogEntry,
  measureId: string,
  dx: number,
  dy: number,
): { annotation: Annotation; edit: boolean } {
  const id = crypto.randomUUID()
  const anchor = { measureId, dx, dy }

  if (entry.spawn === 'line' && entry.lineType) {
    const { endDX, endDY } = defaultLineEnd(entry.lineType, dx, dy)
    return {
      annotation: { id, kind: 'line', lineType: entry.lineType, anchor, endDX, endDY },
      edit: false,
    }
  }
  if (entry.spawn === 'text') {
    return {
      annotation: {
        id, kind: 'text', text: entry.text ?? 'text', anchor,
        style: entry.textStyle ?? { fontFamily: 'serif', fontSize: 16, bold: false, italic: false },
      },
      edit: true,
    }
  }
  // glyph
  return {
    annotation: { id, kind: 'glyph', glyph: entry.glyph ?? '', symbolId: entry.symbolId, anchor, scale: entry.scale },
    edit: false,
  }
}
