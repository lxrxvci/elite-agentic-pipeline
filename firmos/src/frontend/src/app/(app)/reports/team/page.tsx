import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { addDays, formatLocalDate } from '@firmos/domain'
import { RangePicker } from '@/components/reports/range-picker'
import { TeamOverviewTable } from '@/components/reports/team-overview-table'
import { requireStaff } from '@/server/auth/guards'
import { getTeamOverviewReport, mondayOfWeek } from '@/server/capacity'
import { dayLabel } from '@/shared/lib/date-display'

import { resolveRange } from '../_lib/range'

export const metadata: Metadata = { title: 'FirmOS - Team Overview' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['manager', 'admin', 'owner'])

function todayLocal() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

/**
 * Team overview (G5): per-person completion broken out by client tier and
 * cadence over a date range. The default range is the CURRENT WEEK
 * (Monday-Sunday, firm-local); the picker narrows/widens it.
 */
export default async function TeamOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const params = await searchParams
  const weekStart = mondayOfWeek(todayLocal())
  const range = resolveRange({
    from: params.from ?? formatLocalDate(weekStart),
    to: params.to ?? formatLocalDate(addDays(weekStart, 6)),
  })

  const report = await getTeamOverviewReport({
    requesterId: user.id,
    requesterRole: user.normalizedRole,
    fromIso: range.fromIso,
    toIso: range.toIso,
  })

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Team overview
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">
              {dayLabel(range.fromIso)} - {dayLabel(range.toIso)}
            </span>{' '}
            ·{' '}
            {user.normalizedRole === 'manager' ? 'you and your direct reports' : 'all staff'} ·
            done/total by client tier and cadence
          </p>
        </div>
        <RangePicker fromIso={range.fromIso} toIso={range.toIso} />
      </div>

      <TeamOverviewTable report={report} />
    </div>
  )
}
