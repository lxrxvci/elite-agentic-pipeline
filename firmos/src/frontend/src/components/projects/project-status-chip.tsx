import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Project status chip (HANDOFF §20). Color carries the status through the
 * 6-token status language; the label always rides along (never color-alone).
 */
export type ProjectStatusKey = 'pending' | 'in_progress' | 'completed' | 'cancelled'

const STATUS_META: Record<ProjectStatusKey, { status: WorkStatus; label: string }> = {
  pending: { status: 'deferred', label: 'Pending' },
  in_progress: { status: 'due_soon', label: 'In progress' },
  completed: { status: 'on_track', label: 'Completed' },
  cancelled: { status: 'on_hold', label: 'Cancelled' },
}

/** The status token for a project status - also used by the completion meter. */
export function projectStatusToken(status: ProjectStatusKey): WorkStatus {
  return STATUS_META[status].status
}

export function ProjectStatusChip({ status, size = 'sm' }: { status: ProjectStatusKey; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status]
  return <WorkStatusBadge status={meta.status} label={meta.label} size={size} />
}
