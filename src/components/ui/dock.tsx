import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export interface DockItem {
  icon: LucideIcon
  label: string
  onClick?: () => void
}

interface DockProps {
  items: DockItem[]
  className?: string
}

interface DockIconButtonProps {
  icon: LucideIcon
  label: string
  onClick?: () => void
  className?: string
}

const floatingAnimation = {
  initial: { y: 0 },
  animate: {
    y: [-2, 2, -2],
    transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
  },
}

const DockIconButton = React.forwardRef<HTMLButtonElement, DockIconButtonProps>(
  ({ icon: Icon, label, onClick, className }, ref) => (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.1, y: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "relative group p-3 rounded-lg hover:bg-secondary transition-colors",
        className,
      )}
    >
      <Icon className="w-5 h-5 text-foreground" />
      <span
        className={cn(
          "absolute -top-8 left-1/2 -translate-x-1/2",
          "px-2 py-1 rounded text-xs",
          "bg-popover text-popover-foreground",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity whitespace-nowrap pointer-events-none",
        )}
      >
        {label}
      </span>
    </motion.button>
  ),
)
DockIconButton.displayName = "DockIconButton"

export const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ items, className }, ref) => (
    <div ref={ref} className={cn("flex items-center justify-center p-2", className)}>
      <motion.div
        initial="initial"
        animate="animate"
        variants={floatingAnimation}
        className={cn(
          "flex items-center gap-1 p-2 rounded-2xl",
          "backdrop-blur-lg border shadow-lg",
          "bg-background/90 border-border",
          "hover:shadow-xl transition-shadow duration-300",
        )}
      >
        {items.map(item => (
          <DockIconButton key={item.label} {...item} />
        ))}
      </motion.div>
    </div>
  ),
)
Dock.displayName = "Dock"
