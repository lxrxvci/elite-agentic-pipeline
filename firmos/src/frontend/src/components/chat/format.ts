import type { ChatChannelSummary, ChatMessageView } from '@/server/chat'

/**
 * Presentation helpers for team chat. Pure and unit-testable; dates are
 * coerced defensively because action payloads can arrive as strings.
 */

export function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/** "2:04 PM" */
export function formatTimeOfDay(value: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(asDate(value))
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Thread divider label: Today / Yesterday / "Monday, August 24". */
export function formatDayLabel(value: Date | string, now: Date = new Date()): string {
  const date = asDate(value)
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/** Channel list timestamp: time today, weekday this week, else "Aug 24". */
export function formatChannelTimestamp(value: Date | string, now: Date = new Date()): string {
  const date = asDate(value)
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return formatTimeOfDay(date)
  if (diffDays > 0 && diffDays < 7) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
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

export function isSameDay(a: Date | string, b: Date | string): boolean {
  return startOfDay(asDate(a)) === startOfDay(asDate(b))
}

/** §16 mention id form, both spellings. */
export const MENTION_PATTERN = /@([([])(\d+)[)\]]/g
