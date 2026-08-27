'use client'

import { useMemo } from 'react'
import { Check, Lock } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KIND_META } from '@/components/workstation/work-card'
import type { QueueBucket, WorkCard, WorkCardKind } from '@/server/queue'
import { dayLabel, dueAging, periodLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Read-only work row for the client record Work tab - the workstation
 * work-card anatomy (kind icon, period chip, due aging, status badge)
 * without the completion action. Bucketing is identical to the unified
 * queue because the server read reuses that engine.
 */

/** Drill-down from the year grid: keep only rows of one kind in the cell's months. */
export interface WorkCellFilter {
  kind: WorkCardKind
  year: number
  /** Source calendar months the clicked column aggregates. */
  months: number[]
}

const BUCKET_STATUS: Record<QueueBucket, { status: WorkStatus; label: string }> = {
  overdue: { status: 'overdue', label: 'Overdue' },
  due_today: { status: 'due_soon', label: 'Due today' },
  upcoming: { status: 'on_track', label: 'Upcoming' },
  waiting_on_client: { status: 'waiting_client', label: 'Waiting on client' },
  deferred: { status: 'deferred', label: 'Deferred' },
  gated: { status: 'on_hold', label: 'Gated' },
}

interface ClientWorkListProps {
  rows: WorkCard[]
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
  /** When set (year-grid drill-down), only matching rows render. */
  cellFilter?: WorkCellFilter | null
  /** When set, rows get the hover/focus-revealed complete action (same
   *  anatomy as the workstation work card). */
  onComplete?: (card: WorkCard) => void
}

interface PeriodGroup {
  key: string
  label: string
  year: number
  month: number
  rows: WorkCard[]
}

export function ClientWorkList({ rows, today, cellFilter = null, onComplete }: ClientWorkListProps) {
  // Group by attributed month, newest period first; "No period" sorts last.
  const groups = useMemo<PeriodGroup[]>(() => {
    const visible = cellFilter
      ? rows.filter(
          (row) =>
            row.kind === cellFilter.kind &&
            row.attributedYear === cellFilter.year &&
            row.attributedMonth != null &&
            cellFilter.months.includes(row.attributedMonth),
        )
      : rows
    const byKey = new Map<string, PeriodGroup>()
    for (const row of visible) {
      const key =
        row.attributedYear != null && row.attributedMonth != null
          ? `${row.attributedYear}-${String(row.attributedMonth).padStart(2, '0')}`
          : 'none'
      const group =
        byKey.get(key) ??
        ({
          key,
          label: periodLabel(row.attributedYear, row.attributedMonth),
          year: row.attributedYear ?? -1,
          month: row.attributedMonth ?? -1,
          rows: [],
        } satisfies PeriodGroup)
      group.rows.push(row)
      byKey.set(key, group)
    }
    const sorted = [...byKey.values()].sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month,
    )
    for (const g of sorted) {
      g.rows.sort((a, b) => {
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
        if (a.dueDate && !b.dueDate) return -1
        if (!a.dueDate && b.dueDate) return 1
        return a.title.localeCompare(b.title)
      })
    }
    return sorted
  }, [rows, cellFilter])

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {group.label}
            <span className="tnum font-semibold">{group.rows.length}</span>
          </h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {group.rows.map((card) => {
              const { status, label } = BUCKET_STATUS[card.status]
              const { Icon, label: kindLabel } = KIND_META[card.kind]
              const aging = dueAging(card.dueDate, today)
              const gated = card.status === 'gated'
              const badge = <WorkStatusBadge status={status} label={label} />

              return (
                <div
                  key={`${card.kind}:${card.id}`}
                  data-testid="client-work-row"
                  data-kind={card.kind}
                  data-status={card.status}
                  className={cn(
                    'group relative flex h-12 items-center gap-3 border-b border-border pl-5 pr-4 last:border-b-0',
                    card.status === 'waiting_on_client' && 'bg-status-waiting-client-bg/30',
                    card.status === 'deferred' && 'bg-status-deferred-bg/30',
                    gated && 'opacity-60',
                  )}
                >
                  <span
                    role="img"
                    aria-label={kindLabel}
                    title={kindLabel}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>

                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{card.title}</span>
                    <span className="tnum shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {periodLabel(card.attributedYear, card.attributedMonth)}
                    </span>
                  </div>

                  <span
                    className={cn(
                      'tnum hidden w-24 shrink-0 text-right text-xs font-medium sm:block',
                      aging.tone === 'overdue' && 'text-status-overdue',
                      aging.tone === 'today' && 'text-status-due-soon',
                      (aging.tone === 'future' || aging.tone === 'none') && 'text-muted-foreground',
                    )}
                  >
                    {card.status === 'deferred' && card.deferredUntil
                      ? `until ${dayLabel(card.deferredUntil)}`
                      : aging.label}
                  </span>

                  <span className="shrink-0">
                    {gated ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center gap-1">
                            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                            {badge}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Earlier period still open</TooltipContent>
                      </Tooltip>
                    ) : (
                      badge
                    )}
                  </span>

                  {onComplete && (
                    <button
                      type="button"
                      onClick={() => onComplete(card)}
                      aria-label={`Complete: ${card.title}`}
                      title="Complete"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground opacity-0 transition-all duration-150 hover:border-status-on-track hover:bg-status-on-track-bg hover:text-status-on-track focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
