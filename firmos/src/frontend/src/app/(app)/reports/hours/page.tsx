import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { RangePicker } from '@/components/reports/range-picker'
import { TeamHoursTable } from '@/components/reports/team-hours-table'
import { requireStaff } from '@/server/auth/guards'
import { getHoursReport } from '@/server/time-tracking'
import { dayLabel } from '@/shared/lib/date-display'

import { resolveRange } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - Team Hours' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['manager', 'admin', 'owner'])

export default async function TeamHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const range = resolveRange(await searchParams)
  // No userId: the engine scopes managers to direct reports, admin/owner to
  // all staff (§21, server-enforced).
  const report = await getHoursReport({
    requesterId: user.id,
    requesterRole: user.normalizedRole,
    from: range.from,
    to: range.to,
  })

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Team hours
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">
              {dayLabel(range.fromIso)} - {dayLabel(range.toIso)}
            </span>{' '}
            ·{' '}
            {user.normalizedRole === 'manager'
              ? 'your direct reports'
              : 'all staff'}{' '}
            · wall-clock union hours
          </p>
        </div>
        <RangePicker fromIso={range.fromIso} toIso={range.toIso} />
      </div>

      <Card>
        <CardContent className="px-0 pb-0 pt-0">
          <TeamHoursTable users={report.users} fromIso={range.fromIso} toIso={range.toIso} />
        </CardContent>
      </Card>
    </div>
  )
}
