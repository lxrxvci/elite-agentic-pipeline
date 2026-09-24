'use client'

import * as React from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CommissionRow } from '@/server/payroll'

import { CommissionTierBadge } from './commission-tier-badge'
import { moneyLabel } from './format'
import { OnTimeProgressBar } from './on-time-progress-bar'
import { SortableHead, type SortState } from './sortable-head'

/**
 * Per-bookkeeper commission table (HANDOFF §6.6). Rows arrive fully computed
 * from the payroll engine; columns are click-to-sort (D11). On-time sorting
 * keeps the no-data rows at the bottom in both directions.
 */
type CommissionSortKey = 'bookkeeper' | 'onTime' | 'rate' | 'base' | 'commission'

export function CommissionTable({ rows }: { rows: CommissionRow[] }) {
  const [sort, setSort] = React.useState<SortState<CommissionSortKey>>({
    key: 'commission',
    dir: 'desc',
  })

  const sorted = React.useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      let cmp: number
      switch (sort.key) {
        case 'bookkeeper':
          cmp = a.userName.localeCompare(b.userName)
          break
        case 'onTime': {
          // The no-data case (null) always sorts last, either direction.
          if (a.onTimePercent == null && b.onTimePercent == null) cmp = 0
          else if (a.onTimePercent == null) return 1
          else if (b.onTimePercent == null) return -1
          else cmp = a.onTimePercent - b.onTimePercent
          break
        }
        case 'rate':
          cmp = a.rate - b.rate
          break
        case 'base':
          cmp = a.commissionBase - b.commissionBase
          break
        case 'commission':
          cmp = a.commissionAmount - b.commissionAmount
          break
      }
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rows, sort])

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead
            label="Bookkeeper"
            sortKey="bookkeeper"
            sort={sort}
            onSort={setSort}
            defaultDir="asc"
            className="pl-6"
          />
          <SortableHead
            label="On-time"
            sortKey="onTime"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortableHead label="Tier" sortKey="rate" sort={sort} onSort={setSort} className="text-right" />
          <SortableHead
            label="Invoice base"
            sortKey="base"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortableHead
            label="Commission"
            sortKey="commission"
            sort={sort}
            onSort={setSort}
            className="pr-6 text-right"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="pl-6 text-xs text-muted-foreground">
              No commission rows for this month.
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((r) => (
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
