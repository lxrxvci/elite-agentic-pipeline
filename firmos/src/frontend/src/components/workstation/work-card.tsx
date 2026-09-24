'use client'

import * as React from 'react'
import { Check, FileText, Landmark, Lock, RefreshCw, SquareCheck, Timer } from 'lucide-react'

import { moneyLabel } from '@/components/clients/format'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { refreshClockStatus, useClockStatus } from '@/shared/lib/clock-status'
import { avatarStyle } from '@/shared/lib/avatar-hue'
import { dayLabel, dueAging, periodLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { StatusSpine, WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'
import type { QueueBucket, WorkCard, WorkCardKind } from '@/server/queue'

import { CheckDraw } from './check-draw'

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

/**
 * Work-kind identity colors (mandate: color means state OR identity). The
 * kind hue marks TYPE everywhere a work item appears - icon chips, period
 * chips, filter toggles, year-grid rows - while the 6 status tokens keep
 * meaning state. Always paired with the kind icon, never color alone.
 */
export const KIND_STYLE: Record<WorkCardKind, { chip: string; toggle: string }> = {
  bank_feed: {
    chip: 'bg-kind-bank-feed-bg text-kind-bank-feed',
    toggle: 'border-kind-bank-feed bg-kind-bank-feed-bg text-kind-bank-feed',
  },
  reconciliation: {
    chip: 'bg-kind-reconciliation-bg text-kind-reconciliation',
    toggle: 'border-kind-reconciliation bg-kind-reconciliation-bg text-kind-reconciliation',
  },
  report: {
    chip: 'bg-kind-report-bg text-kind-report',
    toggle: 'border-kind-report bg-kind-report-bg text-kind-report',
  },
  task: {
    chip: 'bg-kind-task-bg text-kind-task',
    toggle: 'border-kind-task bg-kind-task-bg text-kind-task',
  },
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
  id: number
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
  const clock = useClockStatus()
  const running = clock?.openTaskTimers.some((t) => t.taskId === taskId) ?? false
  const [busy, setBusy] = React.useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const m = await import('@/server/actions/time')
      const result = running ? await m.stopTaskTimerAction(taskId) : await m.startTaskTimerAction(taskId)
      // Whether it applied or the server rejected it (409), resync everyone
      // from the shared store instead of a per-card status read.
      void result
      await refreshClockStatus()
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
  /** Bumper lanes (D7): opens the override-request dialog for a locked card. */
  onRequestOverride?: (card: WorkCard) => void
}

/**
 * One dense row of the unified queue. 4/8px grid, muted metadata, color only
 * means state, tabular numerals. The complete action is hover/focus-revealed
 * and always visible on the keyboard-selected row (mouse-optional loop).
 *
 * Bumper lanes (D6/D8): a lane-locked card shows the lock + reason in place
 * of the complete affordance, plus a Request-override action (D7) - the
 * server re-enforces the lock on every completion path. An active override
 * unlocks the card and is marked with the "Override" chip.
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
  onRequestOverride,
}: WorkCardRowProps) {
  const { status, label } = BUCKET_STATUS[card.status]
  const { Icon, label: kindLabel } = KIND_META[card.kind]
  const kindStyle = KIND_STYLE[card.kind]
  const aging = dueAging(card.dueDate, today)
  const gated = card.status === 'gated'
  const laneLocked = card.laneLocked === true
  // Completing transition: swap the static check for the self-drawing one.
  // The state change itself is instant (optimistic removal); the draw is
  // pure garnish for the frames the button stays mounted.
  const [completing, setCompleting] = React.useState(false)

  const badge = <WorkStatusBadge status={status} label={label} />

  return (
    <article
      aria-current={selected ? 'true' : undefined}
      data-testid="work-card"
      data-card-key={workCardKey(card)}
      data-card-title={card.title}
      data-kind={card.kind}
      data-status={card.status}
      onClick={() => onSelect(card)}
      className={cn(
        // White card on the cool-gray canvas: 1px border, subtle shadow,
        // slight hover lift; the 3px status spine is the left edge.
        'group relative flex h-12 cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-border bg-card pl-5 pr-3 shadow-card transition-[background-color,box-shadow,transform] duration-150 hover:shadow-pop motion-safe:hover:-translate-y-0.5',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
        card.status === 'waiting_on_client' && 'bg-status-waiting-client-bg/30',
        card.status === 'deferred' && 'bg-status-deferred-bg/30',
        // Gated rows dim with the neutral on-hold tint, never opacity:
        // opacity-60 blends every text color toward the background and
        // drops it below WCAG AA (axe color-contrast).
        gated && 'bg-status-on-hold-bg/40',
      )}
    >
      <StatusSpine status={status} />

      <span
        role="img"
        aria-label={kindLabel}
        title={kindLabel}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          kindStyle.chip,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium text-foreground">{card.title}</span>
        <span
          className={cn(
            'tnum shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            kindStyle.chip,
          )}
        >
          {periodLabel(card.attributedYear, card.attributedMonth)}
        </span>
      </div>

      <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
        {card.clientName}
      </span>

      {/* Reconciliation readiness (owner call notes: statement in + feeds
          done = ready to reconcile). Informational only - completion is
          never blocked. The "Ready" badge uses the on_track token with the
          required dot+label pair; the waiting notes are muted metadata. The
          statement's ending balance sits next to it (money accent, tnum) so
          the reconcile flow reads "statement balance, then reconcile". */}
      {card.kind === 'reconciliation' && card.readyToReconcile != null && (
        card.readyToReconcile ? (
          <span className="inline-flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help" data-testid="recon-ready-badge">
                  <WorkStatusBadge status="on_track" label="Ready" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Statement uploaded and bank feeds complete.</TooltipContent>
            </Tooltip>
            {card.statementBalance != null && (
              <span
                className="tnum text-xs font-semibold text-money-strong"
                data-testid="recon-statement-balance"
              >
                {moneyLabel(card.statementBalance)}
              </span>
            )}
          </span>
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
        {laneLocked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex cursor-help items-center gap-1"
                data-testid="lane-lock"
                data-reason={card.laneLockReason ?? ''}
              >
                <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                <WorkStatusBadge status="on_hold" label="Locked" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{card.laneLockReason ?? 'Locked by bumper lanes'}</TooltipContent>
          </Tooltip>
        ) : card.laneOverride === 'active' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1" data-testid="lane-override-active">
                <WorkStatusBadge status="due_soon" label="Override" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Override approved - this card is unlocked for 24 hours.</TooltipContent>
          </Tooltip>
        ) : gated ? (
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
          <AvatarFallback
            className="text-[10px] font-semibold"
            style={avatarStyle(assignee.id)}
          >
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

      {laneLocked ? (
        // Bumper lanes: the complete affordance is replaced by the lock +
        // override request (D7). Pending requests show their state instead.
        card.laneOverride === 'pending' ? (
          <span
            data-testid="override-pending"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-semibold text-muted-foreground"
          >
            <Lock className="h-3 w-3" aria-hidden />
            Override requested
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRequestOverride?.(card)
            }}
            aria-label={`Request override: ${card.title}`}
            title={card.laneLockReason ?? 'Locked by bumper lanes - request an override'}
            data-testid="request-override"
            className={cn(
              'flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-[10px] font-semibold text-muted-foreground transition-all duration-150 hover:border-firm-action hover:bg-firm-action-soft hover:text-firm-action focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <Lock className="h-3 w-3" aria-hidden />
            Override…
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCompleting(true)
            onComplete(card)
          }}
          aria-label={`Complete: ${card.title}`}
          title="Complete (E)"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-all duration-150 hover:border-firm-action hover:bg-firm-action-soft hover:text-firm-action focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            completing
              ? 'border-status-on-track bg-status-on-track-bg text-status-on-track opacity-100'
              : selected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {completing ? (
            <CheckDraw className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
    </article>
  )
})
