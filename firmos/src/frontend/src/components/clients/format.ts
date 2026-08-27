import { parseLocalDate } from '@firmos/domain'

import { dayLabel } from '@/shared/lib/date-display'

/**
 * Presentation helpers for the Clients surfaces. Date policy: all calendar
 * days are firm-local ISO strings rendered through date-display helpers
 * (HANDOFF §30) - never new Date("YYYY-MM-DD"), never toISOString().slice().
 */

const CADENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
}

export function cadenceLabel(frequency: string): string {
  return CADENCE_LABELS[frequency] ?? frequency
}

/** "Monthly · Close 5th" - cadence plus close tier in one glance. */
export function cadenceTierLabel(frequency: string, closeTier: string | null): string {
  const base = cadenceLabel(frequency)
  if (!closeTier) return base
  const day = Number(closeTier)
  const suffix = day === 5 ? '5th' : day === 10 ? '10th' : '15th'
  return `${base} · Close ${suffix}`
}

/** "Aug 30, 2026" - dayLabel plus the calendar year from the domain parser. */
export function fullDateLabel(iso: string): string {
  return `${dayLabel(iso)}, ${parseLocalDate(iso).year}`
}

/** "$1,240.00" - money columns, tabular numerals applied by the caller. */
export function moneyLabel(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Human labels for account_type storage keys. */
export function accountTypeLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const QBO_TIER_LABELS: Record<string, string> = {
  simple_start: 'Simple Start',
  essentials: 'Essentials',
  plus: 'Plus',
  advanced: 'Advanced',
}

/** QBO plan label; null when the intake never captured one. */
export function qboTierLabel(tier: string | null): string | null {
  if (tier == null) return null
  return QBO_TIER_LABELS[tier] ?? tier
}
