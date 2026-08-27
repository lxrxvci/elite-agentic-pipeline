'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { moneyLabel } from '@/components/clients/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { monthLabel } from '@/shared/lib/date-display'

import type { EmployeeBillingViewRow } from './view-model'

/**
 * By-employee billing report (HANDOFF §15): invoiced totals for the month
 * grouped by the client's bookkeeper (the commission population - invoices
 * sent or paid in the month). Collapsible; collapsed by default.
 */
export function ByEmployeeReport({
  rows,
  year,
  month,
}: {
  rows: EmployeeBillingViewRow[]
  year: number
  month: number
}) {
  const [open, setOpen] = useState(rows.length > 0)

  return (
    <section aria-label="Billing by bookkeeper" className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        )}
        Billing by bookkeeper · {monthLabel(year, month)}
      </button>

      {open &&
        (rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-4 text-xs text-muted-foreground">
            No invoices were sent or paid in {monthLabel(year, month)} yet - the report
            populates once drafts go out.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wider">Bookkeeper</TableHead>
                  <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Invoices</TableHead>
                  <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Invoiced total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.bookkeeperName} className="h-9" data-testid="by-employee-row">
                    <TableCell className="px-4 py-0">
                      <span className="text-sm font-medium text-foreground">{row.bookkeeperName}</span>
                    </TableCell>
                    <TableCell className="tnum px-3 py-0 text-right text-sm text-muted-foreground">
                      {row.invoiceCount}
                    </TableCell>
                    <TableCell className="tnum px-4 py-0 text-right text-sm font-semibold text-foreground">
                      {moneyLabel(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
    </section>
  )
}
