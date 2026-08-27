import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { CapacityGrid } from '@/components/reports/capacity-grid'
import { requireStaff } from '@/server/auth/guards'
import { getCapacityReport } from '@/server/capacity'
import { dayLabel } from '@/shared/lib/date-display'

export const metadata: Metadata = { title: 'FirmOS - Staff Capacity' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['manager', 'admin', 'owner'])

/**
 * Staff capacity (the "who is overloaded" view): one row per visible staff
 * member, one column per week (this week + next four). Cells carry the open
 * work due that week; the current week adds clocked hours against the
 * approved working-hours schedule. Managers see themselves plus their
 * direct reports (§21 parity, enforced in the engine).
 */
export default async function CapacityPage() {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const report = await getCapacityReport({
    requesterId: user.id,
    requesterRole: user.normalizedRole,
  })

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Staff capacity
        </h1>
        <p className="text-xs text-muted-foreground">
          Week of <span className="tnum">{dayLabel(report.weekStartIsos[0])}</span> plus the next
          four weeks ·{' '}
          {report.scope === 'direct_reports' ? 'you and your direct reports' : 'all staff'} · open
          work only
        </p>
      </div>

      <Card>
        <CardContent className="px-0 pb-0 pt-0">
          <CapacityGrid report={report} />
        </CardContent>
      </Card>
    </div>
  )
}
