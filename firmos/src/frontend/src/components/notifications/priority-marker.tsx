import { cn } from '@/shared/lib/utils'

/**
 * Notification priority marker (HANDOFF §16). Only high and urgent get a
 * marker; low/normal render nothing so noise stays muted. Color means state
 * through the 6-token language and the label always rides along - never
 * color alone.
 */
const MARKER: Record<string, { label: string; dot: string; text: string }> = {
  high: { label: 'High', dot: 'bg-status-due-soon', text: 'text-status-due-soon' },
  urgent: { label: 'Urgent', dot: 'bg-status-overdue', text: 'text-status-overdue' },
}

export function PriorityMarker({ priority, className }: { priority: string; className?: string }) {
  const meta = MARKER[priority]
  if (!meta) return null
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', meta.text, className)}
      data-priority={priority}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}
