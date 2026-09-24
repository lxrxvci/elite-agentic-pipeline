import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'
import { formatLocalDate, parseLocalDate } from '@firmos/domain'

import { CalendarViewRoot } from '@/components/calendar/calendar-view'
import type { CalendarClientOption } from '@/components/calendar/meeting-dialog'
import { monthGridRange, weekRange, type CalendarView } from '@/components/calendar/view-model'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { requireStaff } from '@/server/auth/guards'
import { getCalendarDay, getCalendarRange } from '@/server/calendar'
import { localToday } from '@/server/dates'
import { firmTimezone } from '@/server/notifications'

export const metadata: Metadata = { title: 'FirmOS - Calendar' }

// Per-day operational data - never statically prerendered.
export const dynamic = 'force-dynamic'

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^(\d{4})-(\d{2})$/

/**
 * /calendar (Phase 3C): the internal month/week calendar - meetings plus
 * work items by due date, with the stay-on-page day drill. Staff only (the
 * actions re-guard every mutation). URL carries view/month/day so a view is
 * shareable.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; day?: string }>
}) {
  await requireStaff()
  const params = await searchParams
  const today = localToday()
  const todayIso = formatLocalDate(today)

  const view: CalendarView = params.view === 'week' ? 'week' : 'month'
  const selectedDate = params.day && ISO_DAY_RE.test(params.day) ? params.day : todayIso

  const monthParam = params.month && MONTH_RE.exec(params.month)
  const viewYear = monthParam ? Number(monthParam[1]) : today.year
  const viewMonth =
    monthParam && Number(monthParam[2]) >= 1 && Number(monthParam[2]) <= 12
      ? Number(monthParam[2])
      : today.month

  const range =
    view === 'week' ? weekRange(selectedDate) : monthGridRange(viewYear, viewMonth)

  const [days, initialDay, clientRows] = await Promise.all([
    getCalendarRange(parseLocalDate(range.start), parseLocalDate(range.end)),
    getCalendarDay(parseLocalDate(selectedDate)),
    db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .orderBy(asc(clients.legalName)),
  ])

  const clientOptions: CalendarClientOption[] = clientRows.map((c) => ({
    id: c.id,
    name: c.dbaName ?? c.legalName,
  }))

  return (
    <CalendarViewRoot
      view={view}
      viewYear={viewYear}
      viewMonth={viewMonth}
      days={days}
      initialDay={initialDay}
      selectedDate={selectedDate}
      todayIso={todayIso}
      timeZone={firmTimezone()}
      clients={clientOptions}
    />
  )
}
