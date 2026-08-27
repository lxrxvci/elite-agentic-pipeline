'use client'

import * as React from 'react'
import { MessageSquareWarning } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { AdminFeedbackRow } from '@/server/admin-reads'
import { updateFeedbackStatusAction, type FeedbackStatus } from '@/server/actions/admin'
import { relativeTime } from '@/components/notifications/relative-time'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * /admin/feedback triage (HANDOFF §16): the staff feedback queue with the
 * pending -> reviewed -> addressed pipeline. Status moves through
 * updateFeedbackStatusAction (admin/owner, audit-logged); the chip maps the
 * pipeline onto the 6-token status language with the label always present.
 */

const STATUS_META: Record<FeedbackStatus, { status: WorkStatus; label: string }> = {
  pending: { status: 'due_soon', label: 'Pending' },
  reviewed: { status: 'deferred', label: 'Reviewed' },
  addressed: { status: 'on_track', label: 'Addressed' },
}

const CATEGORY_LABEL: Record<AdminFeedbackRow['category'], string> = {
  bug: 'Bug',
  feature: 'Feature',
  other: 'Other',
}

/** The next action in the pipeline, or null when addressed (reopen offered). */
function nextAction(status: FeedbackStatus): { label: string; to: FeedbackStatus } | null {
  if (status === 'pending') return { label: 'Mark reviewed', to: 'reviewed' }
  if (status === 'reviewed') return { label: 'Mark addressed', to: 'addressed' }
  return null
}

export function FeedbackList({ rows: initialRows }: { rows: AdminFeedbackRow[] }) {
  const [rows, setRows] = React.useState(initialRows)
  const [busyId, setBusyId] = React.useState<number | null>(null)

  async function setStatus(row: AdminFeedbackRow, status: FeedbackStatus) {
    setBusyId(row.id)
    try {
      const res = await updateFeedbackStatusAction(row.id, status)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status } : r)))
    } finally {
      setBusyId(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <MessageSquareWarning className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No feedback yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Staff reports from the Send feedback widget in the top bar land here for triage.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((row) => {
        const meta = STATUS_META[row.status]
        const next = nextAction(row.status)
        return (
          <li key={row.id} data-testid="feedback-row" className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
                  {CATEGORY_LABEL[row.category]}
                </span>
                <WorkStatusBadge status={meta.status} label={meta.label} />
                <span className="text-xs text-muted-foreground">
                  {row.userName} · {relativeTime(row.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-foreground">{row.message}</p>
              {row.pageUrl && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  from <code>{row.pageUrl}</code>
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {next && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={busyId === row.id}
                  onClick={() => void setStatus(row, next.to)}
                >
                  {next.label}
                </Button>
              )}
              {row.status !== 'pending' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busyId === row.id}
                  onClick={() => void setStatus(row, 'pending')}
                >
                  Reopen
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
