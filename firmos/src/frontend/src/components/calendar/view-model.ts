import { parseLocalDate, type LocalDate } from '@firmos/domain'

/**
 * View-model math for /calendar (Phase 3C): pure civil-date helpers, no DB,
 * no client clock. All day arithmetic goes through Date.UTC as a calendar
 * oracle (the shared/lib/date-display pattern), so no timezone shift leaks.
 */

export type CalendarView = 'month' | 'week'

export function isoOf(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

export function addDaysIso(iso: string, n: number): string {
  const d = parseLocalDate(iso)
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n))
  return isoOf({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() })
}

/** 0 = Sunday … 6 = Saturday for an ISO-local day. */
export function weekdayOfIso(iso: string): number {
  const d = parseLocalDate(iso)
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
}

/** Sunday-start grid covering the whole month (4-6 rows of 7). */
export function monthGridRange(year: number, month: number): { start: string; end: string } {
  const first = isoOf({ year, month, day: 1 })
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = isoOf({ year, month, day: lastDay })
  const start = addDaysIso(first, -weekdayOfIso(first))
  const end = addDaysIso(last, 6 - weekdayOfIso(last))
  return { start, end }
}

/** Sunday-Saturday week containing `iso`. */
export function weekRange(iso: string): { start: string; end: string } {
  const dow = weekdayOfIso(iso)
  return { start: addDaysIso(iso, -dow), end: addDaysIso(iso, 6 - dow) }
}

export function monthOf(iso: string): { year: number; month: number } {
  const d = parseLocalDate(iso)
  return { year: d.year, month: d.month }
}

/** Canonical /calendar URL for a view + anchor day. */
export function calendarHref(view: CalendarView, anchorIso: string): string {
  const { year, month } = monthOf(anchorIso)
  return `/calendar?view=${view}&month=${year}-${String(month).padStart(2, '0')}&day=${anchorIso}`
}

/**
 * Nav targets. Month view steps whole months (anchored on today's day when
 * the target month contains today, else the 1st); week view steps 7 days.
 */
export function prevHref(view: CalendarView, anchorIso: string, todayIso: string): string {
  if (view === 'week') return calendarHref('week', addDaysIso(anchorIso, -7))
  const { year, month } = monthOf(anchorIso)
  const prev = new Date(Date.UTC(year, month - 2, 1))
  const py = prev.getUTCFullYear()
  const pm = prev.getUTCMonth() + 1
  const t = parseLocalDate(todayIso)
  const day = py === t.year && pm === t.month ? t.day : 1
  return calendarHref('month', isoOf({ year: py, month: pm, day }))
}

export function nextHref(view: CalendarView, anchorIso: string, todayIso: string): string {
  if (view === 'week') return calendarHref('week', addDaysIso(anchorIso, 7))
  const { year, month } = monthOf(anchorIso)
  const next = new Date(Date.UTC(year, month, 1))
  const ny = next.getUTCFullYear()
  const nm = next.getUTCMonth() + 1
  const t = parseLocalDate(todayIso)
  const day = ny === t.year && nm === t.month ? t.day : 1
  return calendarHref('month', isoOf({ year: ny, month: nm, day }))
}

/** "2:30 PM" from a "HH:MM" 24-hour value (display only). */
export function timeLabel24(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}
