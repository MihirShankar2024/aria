import { motion, AnimatePresence } from "framer-motion"
import { useState } from "react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolbarItem {
  id: string
  label: string
  icon: LucideIcon
  /** If true, clicking toggles active state; if false, it acts like a radio within its group */
  toggle?: boolean
}

export interface ToolbarGroup {
  items: ToolbarItem[]
}

interface ToolbarProps {
  /** Groups of items separated by dividers. Customize by passing your own groups. */
  groups: ToolbarGroup[]
  /** Called when any item is clicked, with the item id and new active state */
  onAction?: (id: string, active: boolean) => void
  className?: string
}

// ─── ToolbarButton ────────────────────────────────────────────────────────────

function ToolbarButton({
  item,
  isActive,
  onClick,
  tooltip,
  showTooltip,
  hideTooltip,
}: {
  item: ToolbarItem
  isActive: boolean
  onClick: () => void
  tooltip: string | null
  showTooltip: (label: string) => void
  hideTooltip: () => void
}) {
  const Icon = item.icon
  return (
    <div
      className="relative"
      onMouseEnter={() => showTooltip(item.label)}
      onMouseLeave={hideTooltip}
    >
      <button
        className={cn(
          "h-8 w-8 flex items-center justify-center rounded-md transition-colors duration-200 focus:outline-none",
          isActive ? "bg-primary/15 text-primary" : "text-foreground/70 hover:bg-primary/10 hover:text-foreground",
        )}
        aria-label={item.label}
        aria-pressed={isActive}
        onClick={onClick}
      >
        <Icon className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {tooltip === item.label && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="text-nowrap font-medium absolute bottom-10 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs rounded-md px-2 py-1 shadow-lg pointer-events-none z-50"
          >
            {item.label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export function Toolbar({ groups, onAction, className }: ToolbarProps) {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<string | null>(null)

  function handleClick(item: ToolbarItem) {
    const next = !activeIds.has(item.id)
    setActiveIds(prev => {
      const s = new Set(prev)
      if (next) s.add(item.id)
      else s.delete(item.id)
      return s
    })
    onAction?.(item.id, next)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 320 }}
      className={cn(
        "inline-flex items-center gap-1 p-1 rounded-lg bg-secondary border border-primary/10 shadow-lg",
        className,
      )}
    >
      {groups.map((group, gi) => (
        <span key={gi} className="contents">
          {gi > 0 && <div className="w-px h-6 bg-border mx-0.5" />}
          {group.items.map(item => (
            <ToolbarButton
              key={item.id}
              item={item}
              isActive={activeIds.has(item.id)}
              onClick={() => handleClick(item)}
              tooltip={tooltip}
              showTooltip={setTooltip}
              hideTooltip={() => setTooltip(null)}
            />
          ))}
        </span>
      ))}
    </motion.div>
  )
}
