'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getPayrollCsvAction } from '@/server/actions/time'
import type { PayrollCalculator } from '@/server/payroll'
import { dayLabel } from '@/shared/lib/date-display'

import { moneyLabel } from './format'

/**
 * Payroll calculator (HANDOFF §15): hours are the server interval union,
 * pay is domain math - the client formats and expands, never recomputes.
 * Money is right-aligned, tabular numerals, with a firm total row.
 */

interface PayrollTableProps {
  calc: PayrollCalculator
}

export function PayrollTable({ calc }: PayrollTableProps) {
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set())
  const [csvBusy, setCsvBusy] = React.useState(false)
  const [csvError, setCsvError] = React.useState<string | null>(null)

  function toggle(userId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function downloadCsv() {
    setCsvBusy(true)
    setCsvError(null)
    try {
      const result = await getPayrollCsvAction(calc.year, calc.month)
      if (!result.ok) {
        setCsvError(result.error)
        return
      }
      const blob = new Blob([result.data], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payroll-${calc.year}-${String(calc.month).padStart(2, '0')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setCsvBusy(false)
    }
  }

  const totals = calc.rows.reduce(
    (acc, r) => ({
      hours: acc.hours + r.totalHours,
      hourly: acc.hourly + r.hourlyTotal,
      commission: acc.commission + (r.commission?.amount ?? 0),
      pay: acc.pay + r.totalPay,
    }),
    { hours: 0, hourly: 0, commission: 0, pay: 0 },
  )

  return (
    <div>
      <div className="flex items-center justify-end gap-2 px-4 pt-3">
        {csvError && (
          <p role="alert" className="text-[11px] text-status-overdue">
            {csvError}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void downloadCsv()}
          disabled={csvBusy || calc.rows.length === 0}
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          {csvBusy ? 'Preparing...' : 'Export CSV'}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 pl-4" />
            <TableHead>Team member</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Hourly pay</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Total pay</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calc.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="pl-4 text-xs text-muted-foreground">
                No active staff for this month.
              </TableCell>
            </TableRow>
          ) : (
            calc.rows.map((r) => {
              const open = expanded.has(r.userId)
              return (
                <React.Fragment key={r.userId}>
                  <TableRow
                    data-testid="payroll-row"
                    className="cursor-pointer"
                    onClick={() => toggle(r.userId)}
                  >
                    <TableCell className="w-8 pl-4">
                      {open ? (
                        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-foreground">{r.userName}</span>
                      <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {r.role}
                      </span>
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {r.totalHours.toFixed(2)}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm text-muted-foreground">
                      {moneyLabel(r.baseHourlyPay)}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {moneyLabel(r.hourlyTotal)}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {r.commission ? (
                        <>
                          {moneyLabel(r.commission.amount)}
                          <span className="block text-[11px] text-muted-foreground">
                            pays {dayLabel(r.commission.payoutDate)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm font-bold text-money-strong">
                      {moneyLabel(r.totalPay)}
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={7} className="py-3 pl-12 pr-6">
                        <div className="space-y-1">
                          {r.periods.map((p) => (
                            <p key={p.key} className="flex items-baseline gap-3 text-xs">
                              <span className="w-40 text-muted-foreground">
                                {p.key === 'first' ? '1st - 15th' : '16th - end'} ·{' '}
                                <span className="tnum">
                                  {dayLabel(p.start)} - {dayLabel(p.end)}
                                </span>
                              </span>
                              <span className="tnum w-20 text-right">{p.hours.toFixed(2)} h</span>
                              <span className="tnum w-24 text-right">{moneyLabel(p.hourlyPay)}</span>
                              <span className="text-muted-foreground">
                                pays <span className="tnum">{dayLabel(p.payDate)}</span>
                              </span>
                            </p>
                          ))}
                          {r.commission && (
                            <p className="pt-1 text-xs text-muted-foreground">
                              Commission: <span className="tnum">{r.commission.rate}%</span> of{' '}
                              <span className="tnum">{moneyLabel(r.commission.base)}</span> invoice
                              base
                              {r.commission.onTimePercent != null && (
                                <>
                                  {' '}
                                  · on-time{' '}
                                  <span className="tnum">{r.commission.onTimePercent.toFixed(0)}%</span>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })
          )}
          {calc.rows.length > 0 && (
            <TableRow className="border-t-2 font-medium" data-testid="payroll-total-row">
              <TableCell className="pl-4" />
              <TableCell className="text-sm">Firm total</TableCell>
              <TableCell className="tnum text-right text-sm">{totals.hours.toFixed(2)}</TableCell>
              <TableCell />
              <TableCell className="tnum text-right text-sm">{moneyLabel(totals.hourly)}</TableCell>
              <TableCell className="tnum text-right text-sm">
                {moneyLabel(totals.commission)}
              </TableCell>
              <TableCell className="tnum text-right text-sm font-bold text-money-strong">
                {moneyLabel(totals.pay)}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
