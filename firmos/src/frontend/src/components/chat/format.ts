import type { ChatChannelSummary, ChatMessageView } from '@/server/chat'

/**
 * Presentation helpers for team chat. Pure and unit-testable; dates are
 * coerced defensively because action payloads can arrive as strings.
 *
 * Hydration rule (live-verified 2026-09): pass the firm timezone
 * (FIRMOS_TIMEZONE) everywhere - without it the server renders UTC while
 * the browser hydrates in the viewer's zone, React throws #418, and the
 * boundary re-renders client-side (dead clicks through the window).
 */

export function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Firm-local calendar-day key ("2026-09-25") for day-boundary math. */
function dayKey(d: Date, timeZone?: string): string {
  if (timeZone == null) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d)
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** "2:04 PM" */
export function formatTimeOfDay(value: Date | string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(asDate(value))
}

function startOfDay(d: Date, timeZone?: string): number {
  if (timeZone == null) return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // A day-key ordinal: parse the firm-local key back as UTC so day
  // differences are exact calendar diffs in the firm zone.
  const [y, m, day] = dayKey(d, timeZone).split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}

/** Thread divider label: Today / Yesterday / "Monday, August 24". */
export function formatDayLabel(value: Date | string, now: Date = new Date(), timeZone?: string): string {
  const date = asDate(value)
  const diffDays = Math.round((startOfDay(now, timeZone) - startOfDay(date, timeZone)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/** Channel list timestamp: time today, weekday this week, else "Aug 24". */
export function formatChannelTimestamp(value: Date | string, now: Date = new Date(), timeZone?: string): string {
  const date = asDate(value)
  const diffDays = Math.round((startOfDay(now, timeZone) - startOfDay(date, timeZone)) / 86_400_000)
  if (diffDays === 0) return formatTimeOfDay(date, timeZone)
  if (diffDays > 0 && diffDays < 7) {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date)
}

export function displayChannelName(channel: ChatChannelSummary): string {
  if (channel.kind === 'general') return 'General'
  if (channel.kind === 'dm') return channel.otherMember?.name ?? 'Direct message'
  return channel.clientName ?? channel.name ?? 'Client channel'
}

/** Sender header repeats only when the author or the moment changes. */
export function showsSenderHeader(
  prev: ChatMessageView | undefined,
  message: ChatMessageView,
): boolean {
  if (!prev) return true
  if (prev.authorId !== message.authorId) return true
  return asDate(message.createdAt).getTime() - asDate(prev.createdAt).getTime() > 5 * 60_000
}

export function isSameDay(a: Date | string, b: Date | string, timeZone?: string): boolean {
  if (timeZone != null) return dayKey(asDate(a), timeZone) === dayKey(asDate(b), timeZone)
  return startOfDay(asDate(a)) === startOfDay(asDate(b))
}

/** §16 mention id form, both spellings. */
export const MENTION_PATTERN = /@([([])(\d+)[)\]]/g
