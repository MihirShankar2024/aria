import { useEffect, useRef, useState } from 'react'
import { Bold, Italic } from 'lucide-react'
import type { Annotation, TextAnnotationStyle } from '../../types/score'
import type { ScoreAction } from '../../state/actions'
import { buildLineShape } from '../../lib/annotations/lineShapes'

/** Which sharpshooter scale handle (if any) a glyph mark exposes, keyed by catalog symbolId. */
function glyphScaleMode(symbolId: string): 'vertical' | 'uniform' | null {
  if (symbolId === 'orn.arpeggio') return 'vertical'        // stretch the arpeggio's height
  if (symbolId === 'sym.repeatBegin' || symbolId === 'sym.repeatEnd') return 'uniform' // scale up repeat signs
  return null
}

interface AnnotationsLayerProps {
  partId: string
  annotations: Annotation[]
  /** Resolve a measure id to its current left-edge x (px). Returns null if the measure is gone. */
  measureX: (measureId: string) => number | null
  /** Staff-top y the annotation dy offsets are measured from. */
  staveY: number
  isSharpshooterMode: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
  dispatch: (action: ScoreAction) => void
}

type DragKind = 'body' | 'start' | 'end' | 'scale'
interface DragState {
  id: string
  kind: DragKind
  startClientX: number
  startClientY: number
  baseDx: number
  baseDy: number
  baseEndDX: number
  baseEndDY: number
  baseScaleX: number
  baseScaleY: number
  scaleMode: 'vertical' | 'uniform' | null
  glyphFs: number
}

const FONT_OPTIONS = ['serif', 'sans-serif', 'monospace']

/**
 * Overlay that renders and edits free-floating annotations for one part. Sits over the VexFlow
 * SVG (pointer-events: none) so placement clicks pass through; individual marks become
 * interactive only in sharpshooter mode (or while a text box is being edited). Marks resolve
 * their position from `measureX(anchor.measureId) + dx`, so they travel with their measure on
 * reflow. Dragging the body moves the anchor; line marks also expose start/end handles for the
 * stretch behaviour (reusing the same model as tie handles).
 */
export function AnnotationsLayer({
  partId, annotations, measureX, staveY, isSharpshooterMode, editingId, setEditingId, dispatch,
}: AnnotationsLayerProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  // Live cursor delta while dragging, applied on top of the base position for smooth feedback.
  const [delta, setDelta] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      setDelta({ dx: e.clientX - drag.startClientX, dy: e.clientY - drag.startClientY })
    }
    const onUp = (e: PointerEvent) => {
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      const ann = annotations.find(a => a.id === drag.id)
      if (ann) {
        if (drag.kind === 'scale' && ann.kind === 'glyph') {
          const d = drag.glyphFs ? dy / drag.glyphFs : 0
          if (drag.scaleMode === 'vertical') {
            dispatch({ type: 'SCALE_ANNOTATION', partId, id: drag.id, scaleX: drag.baseScaleX, scaleY: Math.max(0.4, drag.baseScaleY + d) })
          } else {
            const u = Math.max(0.4, drag.baseScaleY + d)
            dispatch({ type: 'SCALE_ANNOTATION', partId, id: drag.id, scaleX: u, scaleY: u })
          }
        } else if (drag.kind === 'end' && ann.kind === 'line') {
          // Stretch: only the end endpoint moves.
          dispatch({ type: 'STRETCH_ANNOTATION', partId, id: drag.id, endDX: drag.baseEndDX + dx, endDY: drag.baseEndDY + dy })
        } else {
          // Move the anchor (start). For a line body-drag both endpoints travel together, so
          // shift the end by the same delta; a start-handle drag moves only the anchor.
          dispatch({ type: 'MOVE_ANNOTATION', partId, id: drag.id, anchor: { measureId: ann.anchor.measureId, dx: drag.baseDx + dx, dy: drag.baseDy + dy } })
          if (ann.kind === 'line' && drag.kind === 'body') {
            dispatch({ type: 'STRETCH_ANNOTATION', partId, id: drag.id, endDX: drag.baseEndDX + dx, endDY: drag.baseEndDY + dy })
          }
        }
      }
      setDrag(null)
      setDelta({ dx: 0, dy: 0 })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [drag, annotations, dispatch, partId])

  const beginDrag = (e: React.PointerEvent, ann: Annotation, kind: DragKind) => {
    if (!isSharpshooterMode) return
    e.preventDefault()
    e.stopPropagation()
    setDrag({
      id: ann.id,
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      baseDx: ann.anchor.dx,
      baseDy: ann.anchor.dy,
      baseEndDX: ann.kind === 'line' ? ann.endDX : 0,
      baseEndDY: ann.kind === 'line' ? ann.endDY : 0,
      baseScaleX: ann.kind === 'glyph' ? (ann.scaleX ?? 1) : 1,
      baseScaleY: ann.kind === 'glyph' ? (ann.scaleY ?? 1) : 1,
      scaleMode: ann.kind === 'glyph' ? glyphScaleMode(ann.symbolId) : null,
      glyphFs: ann.kind === 'glyph' ? 30 * (ann.scale ?? 1) : 0,
    })
    setDelta({ dx: 0, dy: 0 })
  }

  const liveOffset = (id: string, kind: DragKind): { dx: number; dy: number } =>
    drag && drag.id === id && drag.kind === kind ? delta : { dx: 0, dy: 0 }

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 30, overflow: 'visible' }}>
      {annotations.map(ann => {
        const mx = measureX(ann.anchor.measureId)
        if (mx === null) return null

        // start point (anchor) with live body/start drag offset
        const bodyOff = liveOffset(ann.id, 'body')
        const startOff = drag?.id === ann.id && (drag.kind === 'body' || drag.kind === 'start') ? delta : { dx: 0, dy: 0 }
        const x = mx + ann.anchor.dx + startOff.dx
        const y = staveY + ann.anchor.dy + startOff.dy

        const interactive = isSharpshooterMode || editingId === ann.id

        if (ann.kind === 'glyph') {
          const fs = 30 * (ann.scale ?? 1)
          const scMode = glyphScaleMode(ann.symbolId)
          const scaling = drag?.id === ann.id && drag.kind === 'scale'
          let sx = ann.scaleX ?? 1
          let sy = ann.scaleY ?? 1
          if (scaling) {
            const d = delta.dy / (fs || 1)
            if (scMode === 'vertical') sy = Math.max(0.4, (ann.scaleY ?? 1) + d)
            else { const u = Math.max(0.4, (ann.scaleY ?? 1) + d); sx = u; sy = u }
          }
          return (
            <div
              key={ann.id}
              className="absolute"
              style={{ left: x, top: y, transform: 'translate(-50%, -50%)', pointerEvents: isSharpshooterMode ? 'auto' : 'none', cursor: isSharpshooterMode ? 'move' : 'default' }}
              onPointerDown={e => beginDrag(e, ann, 'body')}
            >
              <span style={{ display: 'inline-block', fontFamily: 'Bravura, serif', fontSize: fs, lineHeight: 1, color: '#18181b', userSelect: 'none', transform: `scale(${sx}, ${sy})`, transformOrigin: 'center' }}>
                {ann.glyph}
              </span>
              {isSharpshooterMode && scMode && (
                <div
                  title={scMode === 'vertical' ? 'Drag to stretch height' : 'Drag to scale'}
                  style={{
                    position: 'absolute',
                    left: scMode === 'uniform' ? `calc(50% + ${(fs * sx) / 2}px)` : '50%',
                    top: `calc(50% + ${(fs * sy) / 2}px)`,
                    transform: 'translate(-50%, -50%)',
                    width: 11, height: 11, borderRadius: '9999px',
                    background: '#a78bfa', border: '1.5px solid #fff', cursor: 'ns-resize',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={e => beginDrag(e, ann, 'scale')}
                />
              )}
            </div>
          )
        }

        if (ann.kind === 'text') {
          return (
            <TextAnnotationView
              key={ann.id}
              x={x} y={y}
              text={ann.text}
              style={ann.style}
              editing={editingId === ann.id}
              interactive={interactive}
              isSharpshooterMode={isSharpshooterMode}
              onPointerDown={e => beginDrag(e, ann, 'body')}
              onStartEdit={() => setEditingId(ann.id)}
              onStopEdit={() => setEditingId(null)}
              onChangeText={text => dispatch({ type: 'UPDATE_TEXT_ANNOTATION', partId, id: ann.id, text })}
              onChangeStyle={style => dispatch({ type: 'UPDATE_TEXT_ANNOTATION', partId, id: ann.id, style })}
            />
          )
        }

        // line annotation. The end endpoint moves on a body-drag (both ends together) or an
        // end-handle drag, but stays put during a start-handle drag.
        const endOff = liveOffset(ann.id, 'end')
        const x1 = x
        const y1 = y
        const x2 = mx + ann.endDX + bodyOff.dx + endOff.dx
        const y2 = staveY + ann.endDY + bodyOff.dy + endOff.dy
        const shape = buildLineShape(ann.lineType, x1, y1, x2, y2)
        return (
          <svg key={ann.id} className="absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
            {/* fat invisible hit line for body drag */}
            {shape.paths.map((p, i) => (
              <path key={`hit-${i}`} d={p.d} stroke="transparent" strokeWidth={12} fill="none"
                style={{ pointerEvents: isSharpshooterMode ? 'stroke' : 'none', cursor: 'move' }}
                onPointerDown={e => beginDrag(e, ann, 'body')} />
            ))}
            {shape.paths.map((p, i) => (
              <path key={i} d={p.d} stroke="#18181b" strokeWidth={p.width ?? 1.4} fill="none"
                strokeDasharray={p.dashed ? '5 4' : undefined} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {shape.glyphs?.map((g, i) => (
              <text key={`g${i}`} x={g.x} y={g.y} fontFamily="Bravura, serif" fontSize={g.size} fill="#18181b">{g.text}</text>
            ))}
            {shape.texts?.map((t, i) => (
              <text key={`t${i}`} x={t.x} y={t.y} fontSize={t.size} fill="#18181b" fontStyle={t.italic ? 'italic' : 'normal'}>{t.text}</text>
            ))}
            {isSharpshooterMode && (
              <>
                <circle cx={x1} cy={y1} r={6} fill="#a78bfa" stroke="#fff" strokeWidth={1.5}
                  style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={e => beginDrag(e, ann, 'start')} />
                <circle cx={x2} cy={y2} r={6} fill="#a78bfa" stroke="#fff" strokeWidth={1.5}
                  style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={e => beginDrag(e, ann, 'end')} />
              </>
            )}
          </svg>
        )
      })}
    </div>
  )
}

function TextAnnotationView({
  x, y, text, style, editing, interactive, isSharpshooterMode,
  onPointerDown, onStartEdit, onStopEdit, onChangeText, onChangeStyle,
}: {
  x: number; y: number; text: string; style: TextAnnotationStyle
  editing: boolean; interactive: boolean; isSharpshooterMode: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onStartEdit: () => void; onStopEdit: () => void
  onChangeText: (t: string) => void; onChangeStyle: (s: TextAnnotationStyle) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  // End editing on a click outside the box (not on blur — clicking the format bar blurs the
  // input, and a blur-to-close would dismiss the bar before the click registers).
  useEffect(() => {
    if (!editing) return
    const onDocDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onStopEdit()
    }
    // Defer so the spawning click doesn't immediately close the fresh editor.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDocDown), 0)
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', onDocDown) }
  }, [editing, onStopEdit])

  const fontStyle: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: '#18181b',
    whiteSpace: 'nowrap',
    lineHeight: 1.1,
  }

  // While editing, swallow pointer/mouse events so clicks inside the box or its format bar
  // don't fall through to the canvas (which would spawn another mark / place a note).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -50%)', pointerEvents: interactive ? 'auto' : 'none' }}>
      {editing ? (
        <div ref={boxRef} className="relative" onPointerDown={stop} onMouseDown={stop} onMouseUp={stop} onClick={stop} onDoubleClick={stop}>
          {/* mini format bar */}
          <div className="absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/15 bg-zinc-900 px-1.5 py-1 shadow-lg" style={{ pointerEvents: 'auto' }}>
            <select
              value={style.fontFamily}
              onChange={e => onChangeStyle({ ...style, fontFamily: e.target.value })}
              className="h-6 rounded bg-white/10 px-1 text-[11px] text-white"
            >
              {FONT_OPTIONS.map(f => <option key={f} value={f} className="bg-zinc-900">{f}</option>)}
            </select>
            <input
              type="number" min={8} max={72} value={style.fontSize}
              onChange={e => onChangeStyle({ ...style, fontSize: Math.max(8, Math.min(72, Number(e.target.value) || style.fontSize)) })}
              className="h-6 w-12 rounded bg-white/10 px-1 text-[11px] text-white"
            />
            <button onClick={() => onChangeStyle({ ...style, bold: !style.bold })}
              className={`rounded p-1 ${style.bold ? 'bg-violet-500/40 text-white' : 'text-white/60 hover:bg-white/10'}`}><Bold className="h-3 w-3" /></button>
            <button onClick={() => onChangeStyle({ ...style, italic: !style.italic })}
              className={`rounded p-1 ${style.italic ? 'bg-violet-500/40 text-white' : 'text-white/60 hover:bg-white/10'}`}><Italic className="h-3 w-3" /></button>
          </div>
          <input
            ref={inputRef}
            value={text}
            onChange={e => onChangeText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onStopEdit() }}
            style={{ ...fontStyle, background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(124,58,237,0.7)', borderRadius: 4, padding: '0 4px', outline: 'none', minWidth: 40 }}
            size={Math.max(text.length, 4)}
          />
        </div>
      ) : (
        <span
          style={{ ...fontStyle, cursor: interactive ? 'move' : 'default', userSelect: 'none' }}
          onPointerDown={onPointerDown}
          onDoubleClick={() => { if (isSharpshooterMode) onStartEdit() }}
        >
          {text || ' '}
        </span>
      )}
    </div>
  )
}
