'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { reviewTimeEditAction } from '@/server/actions/time'
import { WorkStatusBadge } from '@/shared/ui/work'

import { activityLabel, dateTimeLabel } from './format'

/**
 * Admin time-edit review (HANDOFF §17): pending requests with old -> new
 * times and reason; approve applies the corrected times (server
 * recalculates duration), reject leaves the entry untouched. The requester
 * can never review their own request - the server enforces it and the
 * error surfaces verbatim.
 */

export interface TimeEditRow {
  requestId: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requesterName: string
  reviewerName: string | null
  reviewedAt: string | null
  createdAt: string
  reason: string | null
  activityType: string
  clientName: string | null
  originalStartedAt: string
  originalEndedAt: string | null
  requestedStartedAt: string
  requestedEndedAt: string | null
}

function spanLabel(startIso: string, endIso: string | null): string {
  return `${dateTimeLabel(startIso)} - ${endIso ? dateTimeLabel(endIso) : 'open'}`
}

function PendingRow({ row }: { row: TimeEditRow }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function review(approve: boolean) {
    setBusy(true)
    setError(null)
    try {
      const result = await reviewTimeEditAction(row.requestId, approve)
      if (result.ok) router.refresh()
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0" data-testid="time-edit-pending">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {row.requesterName}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {activityLabel(row.activityType)}
              {row.clientName ? ` · ${row.clientName}` : ''}
            </span>
          </p>
          <p className="tnum mt-1 text-xs text-muted-foreground">
            <span className="line-through decoration-status-overdue/60">
              {spanLabel(row.originalStartedAt, row.originalEndedAt)}
            </span>
            <span className="mx-1.5" aria-hidden>
              →
            </span>
            <span className="text-foreground">
              {spanLabel(row.requestedStartedAt, row.requestedEndedAt)}
            </span>
          </p>
          {row.reason && (
            <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{row.reason}&rdquo;</p>
          )}
          {error && (
            <p role="alert" className="mt-1 text-[11px] text-status-overdue">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void review(true)}
            className="h-7 gap-1 px-2 text-xs hover:border-status-on-track hover:bg-status-on-track-bg hover:text-status-on-track"
            aria-label={`Approve ${row.requesterName}'s time edit`}
          >
            <Check aria-hidden className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void review(false)}
            className="h-7 gap-1 px-2 text-xs hover:border-status-overdue hover:bg-status-overdue-bg hover:text-status-overdue"
            aria-label={`Reject ${row.requesterName}'s time edit`}
          >
            <X aria-hidden className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  )
}

export function TimeEditReview({ rows }: { rows: TimeEditRow[] }) {
  const pending = rows.filter((r) => r.status === 'pending')
  const history = rows.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-5">
      <section aria-label="Pending requests">
        <h2 className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Pending
          <span className="tnum font-semibold">{pending.length}</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {pending.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground">
              No pending requests. Corrections staff submit land here.
            </p>
          ) : (
            pending.map((row) => <PendingRow key={row.requestId} row={row} />)
          )}
        </div>
      </section>

      <section aria-label="Review history">
        <h2 className="mb-1.5 flex items-baseline gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          History
          <span className="tnum font-semibold">{history.length}</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Requester</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Requested span</TableHead>
                <TableHead>Reviewed by</TableHead>
                <TableHead className="pr-4 text-right">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="pl-4 text-xs text-muted-foreground">
                    No reviewed requests yet.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((row) => (
                  <TableRow key={row.requestId} data-testid="time-edit-history">
                    <TableCell className="pl-4 text-sm">{row.requesterName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {activityLabel(row.activityType)}
                      {row.clientName ? ` · ${row.clientName}` : ''}
                    </TableCell>
                    <TableCell className="tnum text-xs">
                      {spanLabel(row.requestedStartedAt, row.requestedEndedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.reviewerName ?? '-'}
                      {row.reviewedAt ? ` · ${dateTimeLabel(row.reviewedAt)}` : ''}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <WorkStatusBadge
                        status={row.status === 'approved' ? 'on_track' : 'on_hold'}
                        label={
                          row.status === 'approved'
                            ? 'Approved'
                            : row.status === 'rejected'
                              ? 'Rejected'
                              : 'Cancelled'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
