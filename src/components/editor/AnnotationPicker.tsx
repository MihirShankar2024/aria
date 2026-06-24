import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover'
import { ANNOTATION_CATALOG, type CatalogEntry } from '../../lib/annotations/catalog'

interface AnnotationPickerProps {
  /** Fires when an entry is chosen: arms the Annotations tool with that entry and closes the panel. */
  onPick: (entry: CatalogEntry) => void
  /** Bulk-place a measure-number box on every `every` measures, starting from measure `start`. */
  onAddMeasureNumbers: (every: number, start: number) => void
  children: React.ReactNode
}

/**
 * Hover-opened, multi-slide panel for the Annotations tool — an emoji-picker-style popup where
 * each page is one category (Dynamics, Ornaments, Symbols, Text) and the arrows / tab strip page
 * between them. Glyph cells render in Bravura so they match standard engraving; clicking an entry
 * arms the tool (mirrors PolyrhythmPicker's onConfirm) so the next score click spawns the mark.
 */
export function AnnotationPicker({ onPick, onAddMeasureNumbers, children }: AnnotationPickerProps) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [bulkOpen, setBulkOpen] = useState(false)
  // Kept as strings so the field can be fully cleared while typing; coerced to ≥1 only on submit.
  const [every, setEvery] = useState('1')
  const [start, setStart] = useState('1')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }

  const category = ANNOTATION_CATALOG[page]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex" onMouseEnter={() => { cancelClose(); setOpen(true) }} onMouseLeave={scheduleClose}>
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-72 bg-zinc-900 border-white/15 p-3"
        onOpenAutoFocus={e => e.preventDefault()}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="space-y-3">
          {/* Category pager */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPage(p => (p - 1 + ANNOTATION_CATALOG.length) % ANNOTATION_CATALOG.length)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Previous category"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-xs font-semibold uppercase tracking-wider text-white/70">{category.name}</div>
            <button
              onClick={() => setPage(p => (p + 1) % ANNOTATION_CATALOG.length)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Next category"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Tab strip */}
          <div className="flex gap-1">
            {ANNOTATION_CATALOG.map((cat, i) => (
              <button
                key={cat.id}
                onClick={() => setPage(i)}
                className={`flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors ${
                  i === page ? 'bg-violet-500/30 text-violet-200' : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Entry grid */}
          <div className="grid grid-cols-5 gap-1">
            {category.entries.map(entry => (
              <button
                key={entry.symbolId}
                onClick={() => { onPick(entry); setOpen(false) }}
                className="group relative flex h-11 items-center justify-center overflow-visible rounded bg-white/5 text-white/80 transition-colors hover:bg-violet-500/25 hover:text-white"
              >
                {entry.spawn === 'measureNumber' ? (
                  <span style={{ display: 'inline-block', minWidth: 16, padding: '1px 4px', textAlign: 'center', border: '1px solid currentColor', borderRadius: 2, fontFamily: 'serif', fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>
                    {entry.preview ?? '#'}
                  </span>
                ) : entry.previewFont === 'bravura' ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36, width: '100%', overflow: 'hidden' }}>
                    <span style={{ fontFamily: 'Bravura, serif', fontSize: 22 * (entry.previewScale ?? 1), lineHeight: 1 }}>{entry.glyph}</span>
                  </span>
                ) : (
                  <span className="px-0.5 text-center text-[11px] leading-tight" style={{ fontStyle: entry.textStyle?.italic ? 'italic' : 'normal' }}>
                    {entry.preview ?? entry.label}
                  </span>
                )}
                {/* tiny name tag on hover */}
                <span className="pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-950 px-2.5 py-1 text-sm font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
                  {entry.label}
                </span>
              </button>
            ))}
          </div>

          {/* Bulk measure-numbering — full-width button (matches cell height) that toggles an
              inline "every X measures, starting from Y" form. Only on the Text page. */}
          {category.id === 'text' && (
            <div className="space-y-2">
              <button
                onClick={() => setBulkOpen(o => !o)}
                className={`flex h-11 w-full items-center justify-center rounded text-[11px] font-medium transition-colors ${
                  bulkOpen ? 'bg-violet-500/30 text-violet-200' : 'bg-white/5 text-white/70 hover:bg-violet-500/25 hover:text-white'
                }`}
              >
                Add measure numbers every X measures
              </button>
              {bulkOpen && (
                <div className="space-y-2 rounded border border-white/10 bg-white/5 p-2">
                  <label className="flex items-center justify-between text-[11px] text-white/70">
                    <span>Every</span>
                    <input
                      type="text" inputMode="numeric"
                      value={every}
                      onChange={e => setEvery(e.target.value.replace(/\D/g, ''))}
                      className="h-6 w-16 rounded bg-white/10 px-1 text-right text-[11px] text-white"
                    />
                    <span>measures</span>
                  </label>
                  <label className="flex items-center justify-between text-[11px] text-white/70">
                    <span>Starting from measure</span>
                    <input
                      type="text" inputMode="numeric"
                      value={start}
                      onChange={e => setStart(e.target.value.replace(/\D/g, ''))}
                      className="h-6 w-16 rounded bg-white/10 px-1 text-right text-[11px] text-white"
                    />
                  </label>
                  <button
                    onClick={() => { onAddMeasureNumbers(Math.max(1, Number(every) || 1), Math.max(1, Number(start) || 1)); setBulkOpen(false); setOpen(false) }}
                    className="h-7 w-full rounded bg-violet-500/40 text-[11px] font-medium text-white transition-colors hover:bg-violet-500/60"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/10 pt-2">
            <p className="text-[11px] leading-snug text-white/45">
              Pick a mark, then click the score to place it. Drag — and stretch the brackets/lines —
              in sharpshooter mode.
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/45">
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">+</kbd>
              toggles this tool, defaults to last selected mark.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
