import type { Metadata } from 'next'

import { ProgressionBoard } from '@/components/progression/board'
import { localToday } from '@/server/dates'
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
    </div>
  )
}
