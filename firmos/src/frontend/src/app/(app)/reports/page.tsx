import type { Metadata } from 'next'

import { ReportsIndex } from '@/components/reports/reports-index'
import { requireStaff } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const user = await requireStaff()

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Reports
        </h1>
        <p className="text-xs text-muted-foreground">
          Time, commission, and payroll - the numbers the firm runs on, always current.
        </p>
      </div>
      <ReportsIndex role={user.normalizedRole} />
    </div>
  )
}
