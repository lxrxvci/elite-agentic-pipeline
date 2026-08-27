import type { Metadata } from 'next'

import { Card, CardContent } from '@/components/ui/card'
import { CommissionTable } from '@/components/reports/commission-table'
import { CommissionTierCard } from '@/components/reports/commission-tier-card'
import { MonthNav } from '@/components/reports/month-nav'
import { requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getCommissionReport } from '@/server/payroll'
import { monthLabel } from '@/shared/lib/date-display'

import { resolveMonth } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - My Commission' }
export const dynamic = 'force-dynamic'

/**
 * Personal commission view. The engine computes the firm-wide report; the
 * page keeps only the caller's own row, so no other bookkeeper's figures
 * leave the server.
 */
export default async function MyCommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireStaff()
  const { year, month } = resolveMonth(await searchParams)
  const report = await getCommissionReport(year, month, localToday())
  const mine = report.rows.filter((r) => r.userId === user.id)

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            My commission
          </h1>
          <p className="text-xs text-muted-foreground">
            {monthLabel(year, month)} · on-time % sets your tier
          </p>
        </div>
        <MonthNav year={year} month={month} />
      </div>

      {user.normalizedRole === 'bookkeeper' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card>
            <CardContent className="px-0 pb-0 pt-0">
              <CommissionTable rows={mine} />
            </CardContent>
          </Card>
          <CommissionTierCard />
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium text-foreground">Commission applies to bookkeepers</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your role is {user.normalizedRole} - the firm-wide view lives under Reports →
              Commission for managers and above.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
