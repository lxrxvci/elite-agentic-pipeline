import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { MonthNav } from '@/components/reports/month-nav'
import { PayrollTable } from '@/components/reports/payroll-table'
import { PayoutConfigPopover } from '@/components/reports/payout-config-popover'
import { requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getPayrollCalculator } from '@/server/payroll'
import { monthLabel } from '@/shared/lib/date-display'

import { resolveMonth } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - Payroll' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['admin', 'owner'])

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const { year, month } = resolveMonth(await searchParams)
  const calc = await getPayrollCalculator(year, month, localToday())

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Payroll
          </h1>
          <p className="text-xs text-muted-foreground">
            {monthLabel(year, month)} · semi-monthly periods · union hours x base rate + commission
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PayoutConfigPopover current={calc.payoutConfig.commission_payout} />
          <MonthNav year={year} month={month} />
        </div>
      </div>

      <Card>
        <CardContent className="px-0 pb-0 pt-0">
          <PayrollTable calc={calc} />
        </CardContent>
      </Card>
    </div>
  )
}
