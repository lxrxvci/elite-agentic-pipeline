import type { ClientWorkState } from '@firmos/domain'

import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Client lifecycle state chip (HANDOFF §6.2 four states). Color carries the
 * state meaning through the 6-token status language; the label always rides
 * along so state is never color-alone.
 */
const STATE_META: Record<ClientWorkState, { status: WorkStatus; label: string }> = {
  active: { status: 'on_track', label: 'Active' },
  project_only: { status: 'deferred', label: 'Project' },
  paused: { status: 'on_hold', label: 'Paused' },
  inactive: { status: 'on_hold', label: 'Inactive' },
}

export function ClientStateChip({ state, size = 'sm' }: { state: ClientWorkState; size?: 'sm' | 'md' }) {
  const meta = STATE_META[state]
  return <WorkStatusBadge status={meta.status} label={meta.label} size={size} />
}
