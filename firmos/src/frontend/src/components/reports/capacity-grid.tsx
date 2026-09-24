'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Flame } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CapacityLoad, CapacityReport, CapacityStaffRow } from '@/server/capacity'
import { dayLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { SortableHead, type SortState } from './sortable-head'

/**
 * The capacity grid: rows are staff, columns are weeks. A cell shows the
 * open cards due that week; the current week adds clocked vs approved hours.
 * State is never color alone: overloaded/heavy cells pair the status-token
 * background with an icon and a text label. The queue is a per-person view,
 * so a row cannot deep-link into someone's workstation - it links to that
 * person's numbers on /reports/hours instead.
 */

const LOAD_META: Record<
  Exclude<CapacityLoad, 'ok'>,
  { label: string; Icon: typeof Flame; cell: string }
> = {
  overloaded: {
    label: 'Overloaded',
    Icon: Flame,
    cell: 'bg-status-overdue-bg text-status-overdue',
  },
  heavy: {
    label: 'Heavy',
    Icon: AlertTriangle,
    cell: 'bg-status-due-soon-bg text-status-due-soon',
  },
}

function LoadTag({ load }: { load: CapacityLoad }) {
  if (load === 'ok') return null
  const meta = LOAD_META[load]
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
      <meta.Icon aria-hidden className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

function formatHours(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toFixed(1)
}

function StaffCell({ row }: { row: CapacityStaffRow }) {
  return (
    <TableCell className="pl-4">
      <Link
        href="/reports/hours"
        className="group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-sm font-medium text-foreground group-hover:underline">
          {row.name}
        </span>
        <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          {row.role}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Hours report
        </span>
      </Link>
    </TableCell>
  )
}

type CapacitySortKey = 'name' | 'thisWeek'

export function CapacityGrid({ report }: { report: CapacityReport }) {
  const { rows, weekStartIsos, thresholds } = report
  // D11: sortable columns - the sensible ones are the member and this
  // week's open load (clocked hours ride inside the this-week cell).
  const [sort, setSort] = React.useState<SortState<CapacitySortKey>>({ key: 'name', dir: 'asc' })

  const sorted = React.useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      const cmp =
        sort.key === 'name'
          ? a.name.localeCompare(b.name)
          : a.weeks[0].openCount - b.weeks[0].openCount
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rows, sort])

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label="Team member"
              sortKey="name"
              sort={sort}
              onSort={setSort}
              defaultDir="asc"
              className="pl-4"
            />
            {weekStartIsos.map((iso, i) =>
              i === 0 ? (
                <SortableHead
                  key={iso}
                  label="This week"
                  sortKey="thisWeek"
                  sort={sort}
                  onSort={setSort}
                  className="text-center"
                />
              ) : (
                <TableHead key={iso} className="text-center">
                  {`Week of ${dayLabel(iso)}`}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    open cards due
                  </span>
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={weekStartIsos.length + 1}
                className="pl-4 text-xs text-muted-foreground"
              >
                No staff in scope.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => (
              <TableRow key={row.userId} data-testid="capacity-row">
                <StaffCell row={row} />
                {row.weeks.map((cell, i) => (
                  <TableCell
                    key={cell.weekStartIso}
                    data-testid={i === 0 ? 'capacity-cell-current' : undefined}
                    data-load={cell.load}
                    className={cn(
                      'text-center align-top',
                      cell.load !== 'ok' && LOAD_META[cell.load].cell,
                    )}
                  >
                    <span className="tnum block text-sm font-medium">
                      {cell.openCount} {cell.openCount === 1 ? 'card' : 'cards'}
                    </span>
                    {i === 0 && (
                      <span className="tnum block text-[11px] text-muted-foreground">
                        {formatHours(row.clockedMinutesThisWeek)}
                        {row.approvedMinutesPerWeek != null
                          ? ` / ${formatHours(row.approvedMinutesPerWeek)}`
                          : ''}{' '}
                        h clocked
                      </span>
                    )}
                    <LoadTag load={cell.load} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Overload rule: more than <span className="tnum">{thresholds.overloadCards}</span> open
        cards due in a week, or clocked hours over the approved schedule, marks the week
        overloaded; <span className="tnum">{thresholds.heavyCards}</span> or more cards, or{' '}
        <span className="tnum">{Math.round(thresholds.heavyHoursRatio * 100)}%</span> of approved
        hours, marks it heavy. Overdue and undated work counts toward this week.
      </p>
    </div>
  )
}
