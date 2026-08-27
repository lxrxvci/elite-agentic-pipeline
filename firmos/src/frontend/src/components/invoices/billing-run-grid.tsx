'use client'

import Link from 'next/link'

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

import { InvoiceStatusChip } from './invoice-status-chip'
import type { BillingRunGridRow } from './view-model'

/**
 * The monthly billing run at a glance: one compact row per worked client
 * with the state of that month's invoice, so a manager can spot who is
 * still missing from the run. Cells link through to the invoice.
 */
export function BillingRunGrid({
  rows,
  year,
  month,
}: {
  rows: BillingRunGridRow[]
  year: number
  month: number
}) {
  const generated = rows.filter((r) => r.state !== 'not_yet').length
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="tnum font-semibold text-foreground">{generated}</span> of{' '}
        <span className="tnum font-semibold text-foreground">{rows.length}</span> clients
        invoiced for {monthLabel(year, month)}
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Client</TableHead>
              <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                {monthLabel(year, month)}
              </TableHead>
              <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.clientId} className="h-10" data-testid="grid-row" data-state={row.state}>
                <TableCell className="max-w-64 px-4 py-0">
                  <span className="truncate text-sm font-medium text-foreground">{row.clientName}</span>
                </TableCell>
                <TableCell className="px-3 py-0">
                  {row.state === 'not_yet' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-muted-foreground/50" />
                      Not generated
                    </span>
                  ) : row.invoiceId != null ? (
                    <Link
                      href={`/invoices/${row.invoiceId}`}
                      className="inline-flex rounded transition-shadow hover:ring-2 hover:ring-ring/40"
                      aria-label={`Open ${monthLabel(year, month)} invoice for ${row.clientName}`}
                    >
                      <InvoiceStatusChip status={row.state} />
                    </Link>
                  ) : (
                    <InvoiceStatusChip status={row.state} />
                  )}
                </TableCell>
                <TableCell className="tnum px-4 py-0 text-right text-sm font-semibold text-foreground">
                  {row.total != null ? moneyLabel(row.total) : <span className="font-normal text-muted-foreground">-</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
