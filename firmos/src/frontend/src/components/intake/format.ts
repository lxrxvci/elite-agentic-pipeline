import type { WorkStatus } from '@/shared/ui/work'

/**
 * Intake-specific display helpers. Money is always a server-computed number
 * rendered here; the UI never calculates it.
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$1,250" for whole dollars, "$1,250.50" otherwise. */
export function formatMoney(n: number): string {
  return Number.isInteger(n) ? usd.format(n) : usdCents.format(n)
}

export type IntakeStatusKey = 'new' | 'in_progress' | 'pending_review' | 'completed' | 'archived'

/** Intake lifecycle mapped onto the 6-status language (never color alone). */
export const INTAKE_STATUS: Record<IntakeStatusKey, { status: WorkStatus; label: string }> = {
  new: { status: 'on_hold', label: 'New' },
  in_progress: { status: 'due_soon', label: 'In progress' },
  pending_review: { status: 'waiting_client', label: 'Pending review' },
  completed: { status: 'on_track', label: 'Converted' },
  archived: { status: 'on_hold', label: 'Archived' },
}

/** "just now", "12m ago", "3h ago", "2d ago" - relative to a timestamp. */
export function updatedAgo(iso: string, nowMs: number): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((nowMs - then) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
