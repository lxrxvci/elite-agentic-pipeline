import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { addDays, parseLocalDate, type LocalDate } from '@firmos/domain'

import { Card, CardContent } from '@/components/ui/card'
import { MonthNav } from '@/components/reports/month-nav'
import { ProfitabilityTable } from '@/components/reports/profitability-table'
import { requireStaff } from '@/server/auth/guards'
import { getFirmProfitability } from '@/server/profitability'
import { monthLabel } from '@/shared/lib/date-display'

import { fullMonthRange, resolveMonth } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - Profitability' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['manager', 'admin', 'owner'])

/** Firm-local calendar day -> instant (§30 conv. 4, same as reports/_lib/range). */
function dayStart(d: LocalDate): Date {
  return new Date(d.year, d.month - 1, d.day)
}

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const { year, month } = resolveMonth(await searchParams)
  const range = fullMonthRange(year, month)
  const from = dayStart(parseLocalDate(range.fromIso))
  const to = dayStart(addDays(parseLocalDate(range.toIso), 1))
  // The engine clamps `to` to now, so the current month reads at pace.
  const report = await getFirmProfitability(from, to)
  const atPace = report.daysCovered > 0 && report.daysCovered < report.daysInMonth

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Profitability
          </h1>
          <p className="text-xs text-muted-foreground">
            {monthLabel(year, month)} · monthly recurring vs union hours across all staff
            {atPace && ' · month-to-date, paced to the full month'}
          </p>
        </div>
        <MonthNav year={year} month={month} />
      </div>

      <Card>
        <CardContent className="px-0 pb-0 pt-0">
          <ProfitabilityTable rows={report.rows} />
        </CardContent>
      </Card>
    </div>
  )
}
