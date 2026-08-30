import { cn } from '@/shared/lib/utils'
import type { WorkStatus } from '@/shared/ui/work'

import { tierProgress } from './commission-tier-progress'

/**
 * The on-time % tier bar (Wave 5): fill = position within the current tier
 * band, colored by the tier badge's status mapping, always paired with the
 * % figure and a plain-text caption ("4 pts to 45%") so the color is never
 * the only signal.
 */

const FILL: Record<WorkStatus, string> = {
  on_track: 'bg-status-on-track',
  due_soon: 'bg-status-due-soon',
  overdue: 'bg-status-overdue',
  deferred: 'bg-status-deferred',
  waiting_client: 'bg-status-waiting-client',
  on_hold: 'bg-status-on-hold',
}

export function OnTimeProgressBar({ onTimePercent }: { onTimePercent: number }) {
  const progress = tierProgress(onTimePercent)
  const caption = progress.caption ?? 'Top tier'
  return (
    <div className="inline-flex w-36 flex-col items-end gap-1" data-testid="on-time-progress">
      <span className="tnum text-sm">{onTimePercent.toFixed(1)}%</span>
      <span
        role="progressbar"
        aria-valuenow={Math.round(progress.fillPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`On-time ${onTimePercent.toFixed(1)}%, ${caption}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn('block h-full rounded-full', FILL[progress.status])}
          style={{ width: `${progress.fillPercent}%` }}
          data-testid="on-time-progress-fill"
        />
      </span>
      <span className="text-[10px] text-muted-foreground">{caption}</span>
    </div>
  )
}
