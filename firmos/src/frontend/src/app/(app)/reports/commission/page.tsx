import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { CommissionTable } from '@/components/reports/commission-table'
import { CommissionTierCard } from '@/components/reports/commission-tier-card'
import { MonthNav } from '@/components/reports/month-nav'
import { requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getCommissionReport } from '@/server/payroll'
import { monthLabel } from '@/shared/lib/date-display'

import { resolveMonth } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - Commission' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['manager', 'admin', 'owner'])

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const { year, month } = resolveMonth(await searchParams)
  const report = await getCommissionReport(year, month, localToday())

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Commission
          </h1>
          <p className="text-xs text-muted-foreground">
            {monthLabel(year, month)} · on-time % sets the tier · invoices sent or paid in month
          </p>
        </div>
        <MonthNav year={year} month={month} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="px-0 pb-0 pt-0">
            <CommissionTable rows={report.rows} />
          </CardContent>
        </Card>
        <CommissionTierCard />
      </div>
    </div>
  )
}
