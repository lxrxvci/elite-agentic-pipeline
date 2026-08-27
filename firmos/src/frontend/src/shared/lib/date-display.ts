import { parseLocalDate, type LocalDate } from '@firmos/domain'

/**
 * Display-only date formatting for the app shell.
 *
 * Honors the HANDOFF §30 date policy: calendar days are firm-local
 * {year, month, day} values - never `new Date("YYYY-MM-DD")` and never
 * `toISOString().slice(...)`. Day arithmetic below uses Date.UTC purely as
 * a calendar oracle (same pattern as @firmos/domain/src/dates.ts): we read
 * back UTC fields only, so no timezone shift can leak in.
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** "Aug 2026" - the accounting-month label, the system's core concept. */
export function monthLabel(year: number, month: number): string {
  const name = MONTH_NAMES[month - 1]
  if (!name) throw new Error(`invalid month: ${month}`)
  return `${name} ${year}`
}

/** Label for an attributed period that may be missing (ad-hoc tasks). */
export function periodLabel(year: number | null, month: number | null): string {
  return year != null && month != null ? monthLabel(year, month) : 'No period'
}

/** "Aug 30" - short day label for an ISO-local date string. */
export function dayLabel(iso: string): string {
  const d = parseLocalDate(iso)
  return `${MONTH_NAMES[d.month - 1]} ${d.day}`
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

/** Day-of-week for an ISO-local date: 0 = Sunday … 6 = Saturday (UTC oracle). */
export function weekdayOf(iso: string): number {
  const d = parseLocalDate(iso)
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
}

/** Label for a 0-6 day-of-week value (clients.work_day_of_week). */
export function weekdayLabel(day: number, style: 'short' | 'long' = 'short'): string {
  const names = style === 'short' ? WEEKDAY_SHORT : WEEKDAY_LONG
  const label = names[day]
  if (!label) throw new Error(`invalid day of week: ${day}`)
  return label
}

/** Day-number oracle: days since epoch, timezone-free (UTC fields only). */
function dayNumber(d: LocalDate): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)
}

/** Whole days from `today` to `iso` (negative when `iso` is in the past). */
export function diffDaysFromToday(iso: string, todayIso: string): number {
  return dayNumber(parseLocalDate(iso)) - dayNumber(parseLocalDate(todayIso))
}

export type DueTone = 'overdue' | 'today' | 'future' | 'none'

export interface DueAging {
  /** "2d overdue" · "Due today" · "Due tomorrow" · "in 3d" · "No due date" */
  label: string
  tone: DueTone
}

/** Relative due-date aging against the firm-local today (ISO-local strings). */
export function dueAging(dueDateIso: string | null, todayIso: string): DueAging {
  if (!dueDateIso) return { label: 'No due date', tone: 'none' }
  const days = diffDaysFromToday(dueDateIso, todayIso)
  if (days < 0) return { label: `${-days}d overdue`, tone: 'overdue' }
  if (days === 0) return { label: 'Due today', tone: 'today' }
  if (days === 1) return { label: 'Due tomorrow', tone: 'future' }
  return { label: `in ${days}d`, tone: 'future' }
}

/** "Aug 30, 2026" - display label for a real timestamp (ISO or Date). */
export function stampLabel(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
