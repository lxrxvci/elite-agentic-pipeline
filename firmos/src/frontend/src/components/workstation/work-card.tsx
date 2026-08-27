'use client'

import * as React from 'react'
import { Check, FileText, Landmark, Lock, RefreshCw, SquareCheck, Timer } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { dayLabel, dueAging, periodLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { StatusSpine, WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'
import type { QueueBucket, WorkCard, WorkCardKind } from '@/server/queue'

/** Stable identity for a card across buckets and optimistic transitions. */
export function workCardKey(card: Pick<WorkCard, 'kind' | 'id'>): string {
  return `${card.kind}:${card.id}`
}

export const KIND_META: Record<WorkCardKind, { label: string; Icon: typeof Landmark }> = {
  bank_feed: { label: 'Bank feed', Icon: Landmark },
  reconciliation: { label: 'Reconciliation', Icon: RefreshCw },
  report: { label: 'Report', Icon: FileText },
  task: { label: 'Task', Icon: SquareCheck },
}

/** Bucket → the 6-token status language (one meaning = one token, mandate §2). */
const BUCKET_STATUS: Record<QueueBucket, { status: WorkStatus; label: string }> = {
  overdue: { status: 'overdue', label: 'Overdue' },
  due_today: { status: 'due_soon', label: 'Due today' },
  upcoming: { status: 'on_track', label: 'Upcoming' },
  waiting_on_client: { status: 'waiting_client', label: 'Waiting on client' },
  deferred: { status: 'deferred', label: 'Deferred' },
  gated: { status: 'on_hold', label: 'Gated' },
}

export interface AssigneeInfo {
  name: string
  initials: string
}

/**
 * Per-task timer toggle (HANDOFF §6.6: the third, independent timer).
 * Self-contained: it reads getClockStatus on mount and after every toggle,
 * so the running state is always the server's truth. One timer per task -
 * the server rejects a second start and we resync from its answer. Actions
 * are dynamically imported so jsdom tests rendering this row without the
 * time-action mocks keep working.
 */
export function TaskTimerToggle({
  taskId,
  taskTitle,
  revealed,
}: {
  taskId: number
  taskTitle: string
  /** Keyboard-selected rows reveal the idle toggle, matching the complete action. */
  revealed: boolean
}) {
  const [running, setRunning] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void import('@/server/actions/time')
      .then((m) => m.getClockStatusAction())
      .then((r) => {
        if (!cancelled && r.ok) {
          setRunning(r.data.openTaskTimers.some((t) => t.taskId === taskId))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [taskId])

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const m = await import('@/server/actions/time')
      const result = running ? await m.stopTaskTimerAction(taskId) : await m.startTaskTimerAction(taskId)
      if (result.ok) {
        setRunning(result.data.openTaskTimers.some((t) => t.taskId === taskId))
      } else {
        // e.g. 409 "already has a running timer" - resync from the server.
        const status = await m.getClockStatusAction()
        if (status.ok) setRunning(status.data.openTaskTimers.some((t) => t.taskId === taskId))
      }
    } catch {
      // no server reach in tests; leave state as-is
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void toggle(e)}
      disabled={busy}
      aria-label={running ? `Stop task timer: ${taskTitle}` : `Start task timer: ${taskTitle}`}
      aria-pressed={running}
      title={running ? 'Stop task timer' : 'Start task timer'}
      data-testid="task-timer-toggle"
      data-running={running}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all duration-150 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        running
          ? 'border-status-on-track bg-status-on-track-bg text-status-on-track opacity-100'
          : cn(
              'border-input text-muted-foreground hover:border-status-on-track hover:bg-status-on-track-bg hover:text-status-on-track',
              revealed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ),
      )}
    >
      <Timer className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

interface WorkCardRowProps {
  card: WorkCard
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
  selected: boolean
  assignee?: AssigneeInfo
  onSelect: (card: WorkCard) => void
  onComplete: (card: WorkCard) => void
}

/**
 * One dense row of the unified queue. 4/8px grid, muted metadata, color only
 * means state, tabular numerals. The complete action is hover/focus-revealed
 * and always visible on the keyboard-selected row (mouse-optional loop).
 *
 * Memoized: the queue re-renders on every keyboard cursor move, and rows
 * whose props did not change (same card reference, stable callbacks from the
 * parent) skip the render entirely.
 */
export const WorkCardRow = React.memo(function WorkCardRow({
  card,
  today,
  selected,
  assignee,
  onSelect,
  onComplete,
}: WorkCardRowProps) {
  const { status, label } = BUCKET_STATUS[card.status]
  const { Icon, label: kindLabel } = KIND_META[card.kind]
  const aging = dueAging(card.dueDate, today)
  const gated = card.status === 'gated'

  const badge = <WorkStatusBadge status={status} label={label} />

  return (
    <article
      role="option"
      aria-selected={selected}
      data-testid="work-card"
      data-card-key={workCardKey(card)}
      data-card-title={card.title}
      data-kind={card.kind}
      data-status={card.status}
      onClick={() => onSelect(card)}
      className={cn(
        'group relative flex h-12 cursor-pointer items-center gap-3 border-b border-border pl-5 pr-3 transition-colors duration-150 last:border-b-0',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
        card.status === 'waiting_on_client' && 'bg-status-waiting-client-bg/30',
        card.status === 'deferred' && 'bg-status-deferred-bg/30',
        gated && 'opacity-60',
      )}
    >
      <StatusSpine status={status} />

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

      <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
        {card.clientName}
      </span>

      {/* Reconciliation readiness (owner call notes: statement in + feeds
          done = ready to reconcile). Informational only - completion is
          never blocked. The "Ready" badge uses the on_track token with the
          required dot+label pair; the waiting notes are muted metadata. */}
      {card.kind === 'reconciliation' && card.readyToReconcile != null && (
        card.readyToReconcile ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 cursor-help" data-testid="recon-ready-badge">
                <WorkStatusBadge status="on_track" label="Ready" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Statement uploaded and bank feeds complete.</TooltipContent>
          </Tooltip>
        ) : (
          <span
            className="hidden w-28 shrink-0 truncate text-right text-[11px] font-medium text-muted-foreground lg:block"
            data-testid="recon-readiness-note"
          >
            {card.statementAvailable === false ? 'Waiting on statement' : 'Feeds open'}
          </span>
        )
      )}

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

      {assignee ? (
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback className="bg-accent text-[10px] font-semibold text-accent-foreground">
            <span className="sr-only">{assignee.name}</span>
            <span aria-hidden>{assignee.initials}</span>
          </AvatarFallback>
        </Avatar>
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden />
      )}

      {card.kind === 'task' && (
        <TaskTimerToggle taskId={card.id} taskTitle={card.title} revealed={selected} />
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onComplete(card)
        }}
        aria-label={`Complete: ${card.title}`}
        title="Complete (E)"
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-all duration-150 hover:border-status-on-track hover:bg-status-on-track-bg hover:text-status-on-track focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Check className="h-4 w-4" aria-hidden />
      </button>
    </article>
  )
})
