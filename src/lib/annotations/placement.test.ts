import { describe, it, expect } from 'vitest'
import type { Annotation } from '../../types/score'
import { placementRuleFor, layoutMeasureMarks, type PlacementGeom } from './placement'

// ── helpers ──
const anchor = (over: Partial<Annotation extends { anchor: infer A } ? A : never> = {}) =>
  ({ measureId: 'm1', dx: 0, dy: 0, auto: true, ...over }) as never

function glyph(symbolId: string, over: Record<string, unknown> = {}): Annotation {
  return { id: symbolId + Math.random(), kind: 'glyph', glyph: 'x', symbolId, anchor: anchor(over) } as Annotation
}
function text(symbolId: string, txt = 'hi'): Annotation {
  return { id: symbolId, kind: 'text', text: txt, symbolId, anchor: anchor(), style: { fontFamily: 'serif', fontSize: 14, bold: false, italic: false } } as Annotation
}

describe('placementRuleFor', () => {
  it('routes dynamics below with flip', () => {
    expect(placementRuleFor(glyph('dyn.mf'))).toMatchObject({ h: 'measureStart', v: 'belowNotes', flipIfBelowOccupied: true })
  })
  it('routes sforzando to the beat, under the note', () => {
    expect(placementRuleFor(glyph('dyn.sfz'))).toMatchObject({ h: 'event', v: 'belowNotes' })
  })
  it('routes plain text above the notes, tempo above the staff', () => {
    expect(placementRuleFor(text('text.plain'))).toMatchObject({ h: 'measureStart', v: 'aboveNotes' })
    expect(placementRuleFor(text('text.tempo'))).toMatchObject({ h: 'measureStart', v: 'aboveStaff' })
  })
  it('routes ornaments over the note, tremolo on the stem, grace to the left', () => {
    expect(placementRuleFor(glyph('orn.trill'))).toMatchObject({ h: 'eventHead', v: 'aboveNotes' })
    expect(placementRuleFor(glyph('orn.tremolo2'))).toMatchObject({ h: 'event', v: 'onStem' })
    expect(placementRuleFor(glyph('orn.grace'))).toMatchObject({ h: 'eventLeft', v: 'onNote' })
  })
  it('routes repeat signs to the staff center, other symbols above the staff', () => {
    expect(placementRuleFor(glyph('sym.repeatBegin'))).toMatchObject({ h: 'measureStart', v: 'staffCenter' })
    expect(placementRuleFor(glyph('sym.repeatEnd'))).toMatchObject({ h: 'measureEnd', v: 'staffCenter' })
    expect(placementRuleFor(glyph('sym.coda'))).toMatchObject({ h: 'measureStart', v: 'aboveStaff' })
  })
})

const geom: PlacementGeom = {
  staff: { topY: 100, bottomY: 156 },
  measures: new Map([['m1', { measureId: 'm1', leftX: 0, noteStartX: 40, rightX: 240, topNoteY: 110, bottomNoteY: 150 }]]),
  events: new Map([['e1', { x: 60, topY: 110, bottomY: 150, stemTopY: 80, stemBottomY: 150 }]]),
}

describe('layoutMeasureMarks', () => {
  it('places a dynamic below the lowest note', () => {
    const ann = glyph('dyn.f')
    const res = layoutMeasureMarks([ann], geom).get(ann.id)!
    expect(res.y).toBeGreaterThan(geom.staff.bottomY) // below the staff/notes
    expect(res.x).toBeGreaterThan(40)                 // after the sig area (noteStartX)
  })

  it('stacks two overlapping above-notes marks outward (no overlap)', () => {
    const a = text('text.plain')
    const b = { ...text('text.plain'), id: 'b' } as Annotation
    const map = layoutMeasureMarks([a, b], geom)
    const ya = map.get(a.id)!.y
    const yb = map.get('b')!.y
    expect(Math.abs(ya - yb)).toBeGreaterThanOrEqual(18) // pushed apart by ~ROW_H
  })

  it('flips a dynamic above when the below slot is occupied', () => {
    // first a hairpin/other below mark, then a dynamic at the same x → dynamic flips above.
    const below = glyph('dyn.p')                    // occupies below at measureStart
    const dyn = { ...glyph('dyn.f'), id: 'flip' } as Annotation
    const map = layoutMeasureMarks([below, dyn], geom)
    const yBelow = map.get(below.id)!.y
    const yFlip = map.get('flip')!.y
    expect(yBelow).toBeGreaterThan(geom.staff.bottomY)  // stayed below
    expect(yFlip).toBeLessThan(geom.staff.topY)         // flipped above
  })

  it('resolves a two-endpoint gliss between two heads', () => {
    const g2: PlacementGeom = { ...geom, events: new Map([...geom.events, ['e2', { x: 180, topY: 120, bottomY: 120, stemTopY: 100, stemBottomY: 130 }]]) }
    const gliss = { id: 'gl', kind: 'line', lineType: 'gliss', anchor: anchor({ eventId: 'e1' }), endDX: 0, endDY: 0, endEventId: 'e2' } as Annotation
    const res = layoutMeasureMarks([gliss], g2).get('gl')!
    expect(res.x).toBe(60)
    expect(res.x2).toBe(180)
  })

  it('ignores marks with no auto flag', () => {
    const manual = { ...glyph('dyn.f'), anchor: { measureId: 'm1', dx: 5, dy: 5 } } as Annotation
    expect(layoutMeasureMarks([manual], geom).size).toBe(0)
  })
})
