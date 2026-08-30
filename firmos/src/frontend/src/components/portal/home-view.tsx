'use client'

import Link from 'next/link'
import { CheckCircle2, FileUp, Inbox, ReceiptText } from 'lucide-react'

import type { WaitingOnYouItem } from '@/server/portal'
import type { ClientYearGrid, YearGridStream } from '@/server/year-grid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KIND_META, KIND_STYLE } from '@/components/workstation/work-card'
import { WorkStatusBadge } from '@/shared/ui/work'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { formatInstant } from './format'
import { PortalYearProgress } from './year-progress'

/**
 * Portal home (HANDOFF §12 "waiting on client", Wave 4 progress parity). The
 * lead surface is the client's own year grid - the same cell language staff
 * see, read-only - with the guided close stepper for the current period.
 * Below it: the list of work parked on the client with kind-colored
 * identity chips, plus a compact status summary (open requests, recent
 * uploads). An empty waiting list is a celebration, not an error.
 */

export interface RecentUpload {
  id: number
  fileName: string
  createdAt: Date
}

interface PortalHomeViewProps {
  firstName: string
  clientName: string
  waiting: WaitingOnYouItem[]
  openRequestCount: number | null
  recentUploads: RecentUpload[]
  /** Non-draft invoices visible to the portal (§12 read-only list). */
  invoiceCount: number
  /** The acting client's own year grid (engine truth, read-only). */
  progressGrid: ClientYearGrid | null
  /** Streams the acting account may see (tasks row needs can_view_tasks). */
  progressStreams: YearGridStream[]
}

function WaitingRow({ item }: { item: WaitingOnYouItem }) {
  const kind = KIND_META[item.kind]
  const kindStyle = KIND_STYLE[item.kind]
  return (
    <li
      data-testid="waiting-on-you-item"
      data-kind={item.kind}
      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          kindStyle.chip,
        )}
      >
        <kind.Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{item.title}</p>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
              kindStyle.chip,
            )}
          >
            <kind.Icon aria-hidden className="h-3 w-3" />
            {kind.label}
          </span>
          {item.attributedYear != null && item.attributedMonth != null && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {monthLabel(item.attributedYear, item.attributedMonth)}
            </span>
          )}
          <WorkStatusBadge status="waiting_client" label="Needs you" />
        </div>
        {item.note && <p className="mt-1 text-[13px] text-foreground">{item.note}</p>}
        <p className="mt-1 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">What we need: </span>
          {item.neededFromClient}
        </p>
      </div>
    </li>
  )
}

export function PortalHomeView({
  firstName,
  clientName,
  waiting,
  openRequestCount,
  recentUploads,
  invoiceCount,
  progressGrid,
  progressStreams,
}: PortalHomeViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Hi {firstName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Here is where things stand with {clientName}.
        </p>
      </div>

      {progressGrid && (
        <PortalYearProgress
          grid={progressGrid}
          streams={progressStreams}
          prevYearHref={`/portal?year=${progressGrid.year - 1}`}
          nextYearHref={`/portal?year=${progressGrid.year + 1}`}
        />
      )}

      <section aria-labelledby="waiting-on-you-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="waiting-on-you-heading" className="text-sm font-semibold">
            Waiting on you
          </h2>
          {waiting.length > 0 && (
            <span className="tnum text-xs text-muted-foreground">
              {waiting.length} {waiting.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>

        {waiting.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-on-track-bg">
              <CheckCircle2 aria-hidden className="h-5 w-5 text-status-on-track" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">You&apos;re all caught up</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              Nothing is waiting on you right now. When your bookkeeper needs something from you,
              it will show up here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {waiting.map((item) => (
              <WaitingRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Inbox aria-hidden className="h-4 w-4 text-muted-foreground" />
              Open requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openRequestCount == null ? (
              <p className="text-[13px] text-muted-foreground">
                Request tracking is not enabled for this account.
              </p>
            ) : (
              <>
                <p className="tnum text-2xl font-semibold">{openRequestCount}</p>
                <Link href="/portal/requests" className="mt-1 inline-block text-[13px] text-primary hover:underline">
                  View requests
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileUp aria-hidden className="h-4 w-4 text-muted-foreground" />
              Recent uploads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentUploads.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing uploaded yet. Files you send land in Documents.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {recentUploads.map((upload) => (
                  <li key={upload.id} className="flex items-baseline justify-between gap-2 text-[13px]">
                    <a
                      href={`/api/documents/${upload.id}`}
                      className="truncate text-primary hover:underline"
                    >
                      {upload.fileName}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatInstant(upload.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ReceiptText aria-hidden className="h-4 w-4 text-muted-foreground" />
              Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tnum text-2xl font-semibold">{invoiceCount}</p>
            <Link href="/portal/invoices" className="mt-1 inline-block text-[13px] text-primary hover:underline">
              View invoices
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
