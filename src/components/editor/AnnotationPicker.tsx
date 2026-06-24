import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover'
import { ANNOTATION_CATALOG, type CatalogEntry } from '../../lib/annotations/catalog'

interface AnnotationPickerProps {
  /** Fires when an entry is chosen: arms the Annotations tool with that entry and closes the panel. */
  onPick: (entry: CatalogEntry) => void
  children: React.ReactNode
}

/**
 * Hover-opened, multi-slide panel for the Annotations tool — an emoji-picker-style popup where
 * each page is one category (Dynamics, Ornaments, Symbols, Text) and the arrows / tab strip page
 * between them. Glyph cells render in Bravura so they match standard engraving; clicking an entry
 * arms the tool (mirrors PolyrhythmPicker's onConfirm) so the next score click spawns the mark.
 */
export function AnnotationPicker({ onPick, children }: AnnotationPickerProps) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
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
                {entry.previewFont === 'bravura' ? (
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

          <p className="border-t border-white/10 pt-2 text-[11px] leading-snug text-white/45">
            Pick a mark, then click the score to place it. Drag — and stretch the brackets/lines —
            in sharpshooter mode.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
