'use client'

import { ClipboardList } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { OnboardingChecklistRow } from '@/server/clients'
import { avatarStyle } from '@/shared/lib/avatar-hue'
import { dueAging } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Onboarding tab: the checklist copied from the org-wide onboarding
 * templates at conversion, one row per task with its live status. Completed
 * is the only success color; in-flight and blocked states follow the
 * 6-token contract; "not started" is metadata and stays muted.
 */

interface OnboardingPanelProps {
  rows: OnboardingChecklistRow[]
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
}

const STATUS_META: Record<string, { status: WorkStatus; label: string }> = {
  completed: { status: 'on_track', label: 'Completed' },
  blocked: { status: 'on_hold', label: 'Blocked' },
  waiting_on_client: { status: 'waiting_client', label: 'Waiting on client' },
  in_progress: { status: 'due_soon', label: 'In progress' },
  cancelled: { status: 'on_hold', label: 'Cancelled' },
}

function RowStatus({ row }: { row: OnboardingChecklistRow }) {
  const meta = STATUS_META[row.status]
  if (meta) return <WorkStatusBadge status={meta.status} label={meta.label} />
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Not started
    </span>
  )
}

export function OnboardingPanel({ rows, today }: OnboardingPanelProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <ClipboardList className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No onboarding checklist</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Onboarding tasks are seeded from the firm templates when an intake converts.
        </p>
      </div>
    )
  }

  const done = rows.filter((r) => r.status === 'completed').length

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        <span className="tnum font-semibold text-foreground">{done}</span> of{' '}
        <span className="tnum">{rows.length}</span> complete
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row) => {
          const aging = dueAging(row.dueDate, today)
          const open = row.status !== 'completed' && row.status !== 'cancelled'
          return (
            <div
              key={row.id}
              data-testid="onboarding-row"
              data-status={row.status}
              className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-sm font-medium',
                    row.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {row.title}
                </p>
              </div>
              {open && row.dueDate && (
                <span
                  className={cn(
                    'tnum hidden w-24 shrink-0 text-right text-xs font-medium sm:block',
                    aging.tone === 'overdue' && 'text-status-overdue',
                    aging.tone === 'today' && 'text-status-due-soon',
                    (aging.tone === 'future' || aging.tone === 'none') && 'text-muted-foreground',
                  )}
                >
                  {aging.label}
                </span>
              )}
              <span className="shrink-0">
                <RowStatus row={row} />
              </span>
              {row.assignee ? (
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback
                    className="text-[10px] font-semibold"
                    style={avatarStyle(row.assignee.id)}
                  >
                    <span className="sr-only">{row.assignee.name}</span>
                    <span aria-hidden>{row.assignee.initials}</span>
                  </AvatarFallback>
                </Avatar>
              ) : (
                <span className="h-6 w-6 shrink-0" aria-hidden />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
