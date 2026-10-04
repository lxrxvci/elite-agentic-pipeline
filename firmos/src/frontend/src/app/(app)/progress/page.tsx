import type { Metadata } from 'next'

import { ProgressionBoard } from '@/components/progression/board'
import { localToday } from '@/server/dates'
import { listFlaggedItems } from '@/server/flags'
import { getFirmProgressionBoard } from '@/server/progression'

export const metadata: Metadata = { title: 'FirmOS - Progress' }

// Firm-wide, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Progress - the Firm Progression Board (FIRMOS-VISUAL-ELITE-PLAN Wave 2).
 * One screen answering "where is every client" with zero clicks: clients as
 * rows, Jan-Dec as columns, cell truth from the same engine the per-client
 * year grid uses (src/server/progression.ts). This page owns presentation.
 */
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { year: rawYear } = await searchParams
  const today = localToday()
  const parsed = Number(rawYear)
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : today.year
  const board = await getFirmProgressionBoard(year, today)
  // K7 (G1/J7, 09_30 01:19:30): the passive anomaly list for the weekly
  // call - flags, never notifications.
  const flagged = await listFlaggedItems(today)

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Progress
        </h1>
        <p className="text-xs text-muted-foreground">
          Where every client stands in <span className="tnum">{board.year}</span> · every stream,
          every month, zero clicks.
        </p>
      </div>
      <ProgressionBoard board={board} />

      {/* K7 (G1): the weekly-review flag list - passive, never a nag. */}
      <section className="rounded-xl border border-border bg-card" data-testid="flagged-for-review">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Flagged for review</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Work worth naming on the weekly call - overdue items that were never deferred, and tasks running long.
          </p>
        </header>
        {flagged.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="flagged-empty">
            Nothing flagged right now.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="flagged-list">
            {flagged.map((f) => (
              <li key={`${f.reason}-${f.taskId}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5" data-testid={`flag-${f.taskId}`}>
                <span className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{f.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{f.clientName ?? 'No client'}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {f.assigneeName ?? 'Unassigned'} · {f.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
