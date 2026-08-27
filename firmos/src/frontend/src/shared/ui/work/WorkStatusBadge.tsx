/**
 * FirmOS Work Status Badge - THE status color contract.
 * One meaning = one token = identical on every surface (docs/DESIGN_MANDATE.md §2).
 * Never color alone: every badge pairs a leading dot with a text label.
 */
export type WorkStatus =
  | 'overdue'
  | 'due_soon'
  | 'on_track'
  | 'deferred'
  | 'waiting_client'
  | 'on_hold'

interface WorkStatusBadgeProps {
  status: WorkStatus
  size?: 'sm' | 'md'
  /** Optional override, e.g. "Waiting on client" */
  label?: string
}

const config: Record<WorkStatus, { label: string; dot: string; chip: string }> = {
  overdue: {
    label: 'Overdue',
    dot: 'bg-status-overdue',
    chip: 'bg-status-overdue-bg text-status-overdue',
  },
  due_soon: {
    label: 'Due soon',
    dot: 'bg-status-due-soon',
    chip: 'bg-status-due-soon-bg text-status-due-soon',
  },
  on_track: {
    label: 'On track',
    dot: 'bg-status-on-track',
    chip: 'bg-status-on-track-bg text-status-on-track',
  },
  deferred: {
    label: 'Deferred',
    dot: 'bg-status-deferred',
    chip: 'bg-status-deferred-bg text-status-deferred',
  },
  waiting_client: {
    label: 'Waiting on client',
    dot: 'bg-status-waiting-client',
    chip: 'bg-status-waiting-client-bg text-status-waiting-client',
  },
  on_hold: {
    label: 'On hold',
    dot: 'bg-status-on-hold',
    chip: 'bg-status-on-hold-bg text-status-on-hold',
  },
}

const sizes = {
  sm: 'gap-1.5 rounded px-1.5 py-0.5 text-[11px]',
  md: 'gap-1.5 rounded-md px-2 py-1 text-xs',
}

export function WorkStatusBadge({ status, size = 'sm', label }: WorkStatusBadgeProps) {
  const c = config[status]
  return (
    <span
      className={`inline-flex items-center font-semibold ${c.chip} ${sizes[size]}`}
      data-status={status}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label ?? c.label}
    </span>
  )
}

/** Left-edge status spine for queue rows - the glanceable color signal. */
export function StatusSpine({ status }: { status: WorkStatus }) {
  const c = config[status]
  return (
    <span
      aria-hidden
      data-status={status}
      className={`absolute inset-y-0 left-0 w-1 ${c.dot}`}
    />
  )
}

export { config as workStatusConfig }
