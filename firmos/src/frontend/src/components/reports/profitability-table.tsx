import { HandCoins } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ClientProfitability } from '@/server/profitability'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

import { formatHours, moneyLabel } from './format'

/**
 * Per-client profitability (call notes: "charge $100/mo, 10 hours at $25/hr -
 * I need to charge more"). Every figure arrives from the server engine; this
 * table only formats. Margin status tokens: healthy on_track, thin due_soon,
 * negative overdue - and the number is always shown next to the badge, never
 * color alone.
 */

/** Margin below this percent reads "thin" rather than healthy. */
export const HEALTHY_MARGIN_PERCENT = 50

export function marginStatus(margin: number): WorkStatus {
  if (margin < 0) return 'overdue'
  if (margin < HEALTHY_MARGIN_PERCENT) return 'due_soon'
  return 'on_track'
}

export function marginLabel(margin: number): string {
  if (margin < 0) return 'Negative'
  if (margin < HEALTHY_MARGIN_PERCENT) return 'Thin'
  return 'Healthy'
}

/**
 * The inline margin bar (Wave 5): fill width = the margin itself, clamped
 * to the 0-100 track so outliers never break the layout. Negative margins
 * show an empty track - the danger token plus the "Negative" badge already
 * carry that meaning, and a leftward bar would invent a second language.
 */
export function marginBarPercent(margin: number): number {
  return Math.min(100, Math.max(0, margin))
}

const MARGIN_FILL: Record<WorkStatus, string> = {
  on_track: 'bg-status-on-track',
  due_soon: 'bg-status-due-soon',
  overdue: 'bg-status-overdue',
  deferred: 'bg-status-deferred',
  waiting_client: 'bg-status-waiting-client',
  on_hold: 'bg-status-on-hold',
}

function MarginCell({ margin }: { margin: number | null }) {
  if (margin == null) return <span className="text-xs text-muted-foreground">-</span>
  // Negative margins get the danger fg; the figure keeps its minus sign and
  // the "Negative" badge is the text label (never color alone).
  const negative = margin < 0
  const status = marginStatus(margin)
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span
        className={`tnum text-sm font-semibold ${negative ? 'text-money-negative' : 'text-foreground'}`}
      >
        {margin.toFixed(1)}%
      </span>
      <span
        aria-hidden
        className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"
        data-testid="margin-bar"
      >
        <span
          className={`block h-full rounded-full ${MARGIN_FILL[status]}`}
          style={{ width: `${marginBarPercent(margin)}%` }}
          data-testid="margin-bar-fill"
        />
      </span>
      <WorkStatusBadge status={status} label={marginLabel(margin)} />
    </span>
  )
}

export function ProfitabilityTable({ rows }: { rows: ClientProfitability[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <HandCoins className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No active clients</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Active clients appear here with their monthly recurring amount, union hours,
          and effective rate. Paused and inactive clients are excluded.
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Client</TableHead>
          <TableHead className="text-right">Monthly recurring</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Eff. $/hr</TableHead>
          <TableHead className="text-right">Est. labor</TableHead>
          <TableHead className="pr-4 text-right">Margin</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.clientId} data-testid="profitability-row">
            <TableCell className="pl-4">
              <span className="text-sm font-medium text-foreground">{row.clientName}</span>
            </TableCell>
            <TableCell className="tnum text-right text-sm">
              {row.recurringMonthly != null ? (
                moneyLabel(row.recurringMonthly)
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="tnum text-right text-sm text-muted-foreground">
              {formatHours(row.hoursWorked * 60)}
            </TableCell>
            <TableCell className="tnum text-right text-sm font-semibold text-money-strong">
              {row.effectiveHourlyRate != null ? (
                `${moneyLabel(row.effectiveHourlyRate)}/hr`
              ) : (
                <span className="text-xs font-normal text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="tnum text-right text-sm text-muted-foreground">
              {row.laborCostEstimate != null ? (
                moneyLabel(row.laborCostEstimate)
              ) : (
                <span className="text-xs">-</span>
              )}
            </TableCell>
            <TableCell className="pr-4 text-right">
              <MarginCell margin={row.margin} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
