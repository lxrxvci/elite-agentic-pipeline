import { COMMISSION_TIERS, type CommissionTier } from '@firmos/domain'

import type { WorkStatus } from '@/shared/ui/work'

import { tierStatus } from './commission-tier-badge'

/**
 * On-time % position inside the commission tier bands (HANDOFF §6.6). Pure
 * math over the same domain constant the tier reference card renders, so
 * the bar, the badge, and the card can never disagree. The bar fill is the
 * position within the CURRENT band (0 at the band floor, 100 at the next
 * threshold); the caption says what the next rung costs in plain text.
 */

export interface TierProgress {
  /** Rate of the band the on-time % lands in. */
  rate: number
  /** On-time floor of the current band. */
  bandMin: number
  /** On-time floor of the next band up, null at the top tier. */
  nextMin: number | null
  /** Rate of the next band up, null at the top tier. */
  nextRate: number | null
  /** 0-100 fill of the band toward the next threshold (100 at the top). */
  fillPercent: number
  /** "4 pts to 45%" - null at the top tier. */
  caption: string | null
  /** The tier badge's status mapping (the bar's color, never alone). */
  status: WorkStatus
}

/** "4" or "7.5" - whole points when possible, one decimal otherwise. */
function pointsLabel(points: number): string {
  const rounded = Math.round(points * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function tierProgress(
  onTimePercent: number,
  tiers: readonly CommissionTier[] = COMMISSION_TIERS,
): TierProgress {
  const descending = [...tiers].sort((a, b) => b.minOnTimePercent - a.minOnTimePercent)
  const currentIndex = descending.findIndex((t) => onTimePercent >= t.minOnTimePercent)
  // Below every threshold lands in the floor band (the lowest-min tier);
  // the next rung is then the tier directly above it.
  const current = currentIndex === -1 ? descending[descending.length - 1] : descending[currentIndex]
  const nextIndex = currentIndex === -1 ? descending.length - 2 : currentIndex - 1
  const next = nextIndex >= 0 ? descending[nextIndex] : null

  const fillPercent =
    next == null
      ? 100
      : next.minOnTimePercent === current.minOnTimePercent
        ? 100
        : Math.min(
            100,
            Math.max(
              0,
              ((onTimePercent - current.minOnTimePercent) /
                (next.minOnTimePercent - current.minOnTimePercent)) *
                100,
            ),
          )

  return {
    rate: current.rate,
    bandMin: current.minOnTimePercent,
    nextMin: next?.minOnTimePercent ?? null,
    nextRate: next?.rate ?? null,
    fillPercent,
    caption:
      next == null
        ? null
        : `${pointsLabel(next.minOnTimePercent - onTimePercent)} pts to ${next.rate}%`,
    status: tierStatus(current.rate),
  }
}
