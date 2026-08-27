import { cn } from '@/shared/lib/utils'

import { projectStatusToken, type ProjectStatusKey } from './project-status-chip'

/**
 * Project completion meter: a thin bar plus the percent number (never
 * color-alone). The fill follows the project's status token - color means
 * state, the number carries the measure. Tabular numerals throughout.
 */
export function CompletionMeter({
  pct,
  status,
  className,
}: {
  pct: number
  status: ProjectStatusKey
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const token = projectStatusToken(status)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clamped}% complete`}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: `var(--status-${token.replace('_', '-')})` }}
        />
      </div>
      <span className="tnum text-xs font-semibold text-muted-foreground">{clamped}%</span>
    </div>
  )
}
