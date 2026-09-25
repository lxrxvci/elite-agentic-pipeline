import {
  ClipboardCheck,
  Coffee,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  Repeat,
  SquareCheck,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

/**
 * Presentation helpers for the Reports surfaces. Display-only: every number
 * rendered here arrived from the server (interval-union minutes, domain
 * commission math) - nothing re-derives business math client-side.
 */

export type ActivityType =
  | 'bank_feeds'
  | 'tasks'
  | 'recurring'
  | 'dashboard'
  | 'reconciliations'
  | 'projects'
  | 'tax_checklist'
  | 'break_paid'
  | 'break_unpaid'
  | 'lunch_paid'
  | 'lunch_unpaid'

/** The seven non-day workstation activity timers (HANDOFF §17) plus the F2
 *  paid/unpaid break and lunch kinds (walkthrough 02:08:30). */
export const ACTIVITY_META: Record<ActivityType, { label: string; Icon: LucideIcon }> = {
  bank_feeds: { label: 'Bank feeds', Icon: Landmark },
  tasks: { label: 'Tasks', Icon: SquareCheck },
  recurring: { label: 'Recurring', Icon: Repeat },
  dashboard: { label: 'Dashboard', Icon: LayoutDashboard },
  reconciliations: { label: 'Reconciliations', Icon: RefreshCw },
  projects: { label: 'Projects', Icon: FolderKanban },
  tax_checklist: { label: 'Tax checklist', Icon: ClipboardCheck },
  break_paid: { label: 'Break (paid)', Icon: Coffee },
  break_unpaid: { label: 'Break (unpaid)', Icon: Coffee },
  lunch_paid: { label: 'Lunch (paid)', Icon: UtensilsCrossed },
  lunch_unpaid: { label: 'Lunch (unpaid)', Icon: UtensilsCrossed },
}

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_META) as ActivityType[]

export function activityLabel(activityType: string): string {
  if (activityType === 'day') return 'Day session'
  return ACTIVITY_META[activityType as ActivityType]?.label ?? activityType
}

/** "7.50" - hours from server union minutes, tabular numerals via caller. */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2)
}

/** "37.5 h" with trailing zeros trimmed, for totals cards. */
export function hoursLabel(minutes: number): string {
  const h = minutes / 60
  return `${Number.isInteger(h) ? h.toFixed(0) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} h`
}

/** Ticking clock: "mm:ss" under an hour, "h:mm:ss" above. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "$1,240.00" - money columns, tabular numerals applied by the caller. */
export function moneyLabel(amount: number): string {
  if (!Number.isFinite(amount)) return '$0.00'
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * "14:05" wall-clock label for an ISO instant.
 *
 * Hydration rule (live-verified 2026-09): the server renders in ITS timezone
 * (UTC on Vercel) while the browser hydrates in the viewer's - without an
 * explicit `timeZone` the two texts differ, React throws hydration error
 * #418, and the boundary re-renders client-side (buttons sit dead through
 * the recovery window on slow connections). Server pages must pass the firm
 * timezone (FIRMOS_TIMEZONE via firmTimezone()) so both sides agree.
 */
export function timeLabel(iso: string, timeZone?: string): string {
  if (timeZone != null) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  }
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Aug 30, 14:05" - day plus wall-clock for entry lists. */
export function dateTimeLabel(iso: string, timeZone?: string): string {
  if (timeZone != null) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
    }).formatToParts(new Date(iso))
    const part = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${part('month')} ${part('day')}, ${timeLabel(iso, timeZone)}`
  }
  const d = new Date(iso)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${timeLabel(iso)}`
}
