import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-gray-800 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
        {content}
      </div>
    </div>
  )
}
