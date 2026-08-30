'use client'

import { CircleCheck, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { GenerateSummary } from '@/server/invoices'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

/**
 * The billing-run result, kept on the page as a card instead of a toast
 * (Wave 5): created / skipped / empty counts at a glance, the attached-task
 * note, and - the part a manager acts on - the per-client failure list when
 * it fits (8 or fewer; the summary only carries client names for failures).
 */

function Stat({
  value,
  label,
  valueClass,
  testId,
}: {
  value: number
  label: string
  valueClass: string
  testId: string
}) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <span className={cn('tnum font-display text-lg font-bold tracking-tight', valueClass)}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

export function GenerateRunResultCard({
  summary,
  onDismiss,
}: {
  summary: GenerateSummary
  onDismiss: () => void
}) {
  const skipped =
    summary.skippedExisting +
    summary.skippedCadence +
    summary.skippedIneligible +
    summary.skippedNoBilling
  const failures = summary.failures

  return (
    <div
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid="generate-run-result"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-status-on-track" aria-hidden />
          <p className="text-sm font-semibold text-foreground">
            {monthLabel(summary.year, summary.month)} billing run complete
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          onClick={onDismiss}
          aria-label="Dismiss billing run result"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2 pl-6">
        <Stat
          value={summary.invoicesCreated}
          label="created"
          valueClass="text-money-strong"
          testId="run-created"
        />
        <Stat value={skipped} label="skipped" valueClass="text-foreground" testId="run-skipped" />
        <Stat
          value={summary.emptySkipped}
          label="empty, not created"
          valueClass="text-foreground"
          testId="run-empty"
        />
        {failures.length > 0 && (
          <Stat
            value={failures.length}
            label="failed"
            valueClass="text-status-overdue"
            testId="run-failed"
          />
        )}
        {summary.tasksAttached > 0 && (
          <span className="tnum pb-0.5 text-[11px] text-muted-foreground">
            {summary.tasksAttached} billable task{summary.tasksAttached === 1 ? '' : 's'} attached
          </span>
        )}
      </div>

      {failures.length > 0 && (
        failures.length <= 8 ? (
          <ul className="mt-2 space-y-0.5 pl-6" data-testid="run-failure-list">
            {failures.map((f) => (
              <li key={f.clientId} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-status-overdue">{f.clientName}</span>
                {' - '}
                {f.error}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 pl-6 text-[11px] text-muted-foreground" data-testid="run-failure-list">
            {failures.length} clients failed - run the resync after fixing the first few.
          </p>
        )
      )}
    </div>
  )
}
