'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { toast } from 'sonner'

import type { ProjectPeriodCell } from '@/server/projects'
import { setProjectTaskPeriodAction } from '@/server/actions/projects'
import { cn } from '@/shared/lib/utils'

/**
 * time_period monthly grid (HANDOFF §20): twelve cells for the row's target
 * year, one per month. Click toggles that period's completion; the engine
 * completes the row when all twelve are done (and the prerequisite chain
 * allows). Completed cells pair the on_track token with a check mark and
 * the month label - never color-alone.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

interface MonthGridProps {
  taskId: number
  periods: ProjectPeriodCell[]
  /** Cancelled projects are frozen; pending mutations disable cells too. */
  disabled?: boolean
}

export function MonthGrid({ taskId, periods, disabled = false }: MonthGridProps) {
  const router = useRouter()
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())

  async function toggle(cell: ProjectPeriodCell) {
    if (disabled || pendingKeys.has(cell.key)) return
    setPendingKeys((prev) => new Set(prev).add(cell.key))
    const res = await setProjectTaskPeriodAction(taskId, cell.year, cell.month, !cell.completed)
    setPendingKeys((prev) => {
      const next = new Set(prev)
      next.delete(cell.key)
      return next
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="grid grid-cols-6 gap-1 sm:grid-cols-12" data-testid="month-grid">
      {periods.map((cell) => {
        const pending = pendingKeys.has(cell.key)
        return (
          <button
            key={cell.key}
            type="button"
            data-testid="month-cell"
            data-period={cell.key}
            data-completed={cell.completed}
            aria-pressed={cell.completed}
            aria-label={`${MONTH_ABBR[cell.month - 1]} ${cell.year}: ${cell.completed ? 'complete' : 'mark complete'}`}
            disabled={disabled || pending}
            onClick={() => void toggle(cell)}
            className={cn(
              'flex h-8 items-center justify-center gap-1 rounded-md border text-[11px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              cell.completed
                ? 'border-status-on-track/40 bg-status-on-track-bg text-status-on-track'
                : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              (disabled || pending) && 'cursor-not-allowed opacity-60',
            )}
          >
            {cell.completed && <Check className="h-3 w-3" aria-hidden />}
            {MONTH_ABBR[cell.month - 1]}
          </button>
        )
      })}
    </div>
  )
}
