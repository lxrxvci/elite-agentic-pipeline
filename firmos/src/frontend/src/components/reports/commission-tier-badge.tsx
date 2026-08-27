import { Badge } from '@/components/ui/badge'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Commission tier badge (HANDOFF §6.6 tier table). The rate is a performance
 * state, so it uses the status language: 50/45 on track, 40 due soon, 35
 * (below 80% on time, or no data) overdue. A per-user override is config,
 * not state - neutral badge, never a status color.
 */

export function tierStatus(rate: number): WorkStatus {
  if (rate >= 45) return 'on_track'
  if (rate >= 40) return 'due_soon'
  return 'overdue'
}

interface CommissionTierBadgeProps {
  rate: number
  usedOverride: boolean
}

export function CommissionTierBadge({ rate, usedOverride }: CommissionTierBadgeProps) {
  if (usedOverride) {
    return (
      <Badge variant="outline" className="tnum font-semibold">
        Override {rate}%
      </Badge>
    )
  }
  return <WorkStatusBadge status={tierStatus(rate)} label={`${rate}% tier`} />
}
