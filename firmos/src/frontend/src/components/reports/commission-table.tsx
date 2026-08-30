import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CommissionRow } from '@/server/payroll'

import { CommissionTierBadge } from './commission-tier-badge'
import { moneyLabel } from './format'
import { OnTimeProgressBar } from './on-time-progress-bar'

/**
 * Per-bookkeeper commission table (HANDOFF §6.6). Server-rendered: rows
 * arrive fully computed from the payroll engine.
 */
export function CommissionTable({ rows }: { rows: CommissionRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Bookkeeper</TableHead>
          <TableHead className="text-right">On-time</TableHead>
          <TableHead className="text-right">Tier</TableHead>
          <TableHead className="text-right">Invoice base</TableHead>
          <TableHead className="pr-6 text-right">Commission</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="pl-6 text-xs text-muted-foreground">
              No commission rows for this month.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.userId} data-testid="commission-row">
              <TableCell className="pl-6 text-sm font-medium text-foreground">
                {r.userName}
              </TableCell>
              <TableCell className="text-right">
                {r.onTimePercent != null ? (
                  r.usedOverride ? (
                    // An override bypasses the tiers, so there is no band to
                    // progress through - the plain % plus the override badge.
                    <span className="tnum text-sm">{`${r.onTimePercent.toFixed(1)}%`}</span>
                  ) : (
                    <OnTimeProgressBar onTimePercent={r.onTimePercent} />
                  )
                ) : (
                  <span className="text-muted-foreground">No data</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <CommissionTierBadge rate={r.rate} usedOverride={r.usedOverride} />
              </TableCell>
              <TableCell className="tnum text-right text-sm">{moneyLabel(r.commissionBase)}</TableCell>
              <TableCell className="tnum pr-6 text-right text-sm font-medium">
                {moneyLabel(r.commissionAmount)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
