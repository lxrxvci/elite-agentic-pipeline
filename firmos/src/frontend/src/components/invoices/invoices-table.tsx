'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'

import { fullDateLabel, moneyLabel } from '@/components/clients/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { quickbooksCsvAction } from '@/server/actions/invoices'
import { dueAging, monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { downloadCsv } from './csv'
import { INVOICE_STATUSES, monthCsvFilename, type InvoiceStatus } from './format'
import { InvoiceStatusChip } from './invoice-status-chip'
import type { InvoiceListRow } from './view-model'

/**
 * The dense invoice table for one accounting month. Status and client
 * filters are client-side; row selection feeds the QBO CSV export (nothing
 * selected = the whole month, void rows excluded). Money is a numeric
 * string rendered right-aligned in tabular numerals; aging is computed
 * against the firm-local today threaded down from the server.
 */

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

/**
 * The Total column reads state peripherally (Wave 5): open money is the
 * money accent, paid is the healthy token, overdue is danger, drafts and
 * voids stay muted. The status chip right next to it carries the text
 * label, so the tint is never the only signal.
 */
const TOTAL_TONE: Record<InvoiceStatus, string> = {
  draft: 'font-medium text-muted-foreground',
  sent: 'font-bold text-money-strong',
  paid: 'font-bold text-status-on-track',
  overdue: 'font-bold text-status-overdue',
  void: 'font-medium text-muted-foreground line-through',
}

interface InvoicesTableProps {
  rows: InvoiceListRow[]
  year: number
  month: number
  /** Firm-local today, ISO-local - from the server, never the client clock. */
  today: string
}

function DueCell({ row, today }: { row: InvoiceListRow; today: string }) {
  if (!row.dueDate) return <span className="text-xs text-muted-foreground">No due date</span>
  const open = row.status === 'sent' || row.status === 'overdue'
  const aging = open ? dueAging(row.dueDate, today) : null
  const late = aging != null && aging.tone === 'overdue'
  return (
    <div className="flex flex-col justify-center">
      <span
        className={cn(
          'tnum whitespace-nowrap text-xs font-medium',
          late ? 'text-status-overdue' : 'text-foreground',
        )}
      >
        {fullDateLabel(row.dueDate)}
      </span>
      {aging && (
        <span
          className={cn(
            'text-[10px]',
            late ? 'font-semibold text-status-overdue' : 'text-muted-foreground',
          )}
        >
          {aging.label}
        </span>
      )}
    </div>
  )
}

export function InvoicesTable({ rows, year, month, today }: InvoicesTableProps) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)

  const clientOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const r of rows) byId.set(r.clientId, r.clientName)
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false
        if (clientFilter !== 'all' && r.clientId !== Number(clientFilter)) return false
        return true
      }),
    [rows, statusFilter, clientFilter],
  )

  const filtersActive = statusFilter !== 'all' || clientFilter !== 'all'

  function toggleSelected(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function exportCsv() {
    // Nothing selected = every non-void invoice of the month.
    const ids =
      selected.size > 0
        ? [...selected]
        : rows.filter((r) => r.status !== 'void').map((r) => r.id)
    if (ids.length === 0) {
      toast.error('Nothing to export for this month.')
      return
    }
    setExporting(true)
    const res = await quickbooksCsvAction(ids)
    setExporting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    downloadCsv(monthCsvFilename(year, month), res.data)
    toast.success(`QuickBooks CSV downloaded (${ids.length} invoice${ids.length === 1 ? '' : 's'})`)
  }

  return (
    <div className="space-y-2">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="h-8 w-52 text-xs" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setStatusFilter('all')
              setClientFilter('all')
            }}
          >
            Clear
          </Button>
        )}

        <div className="ml-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={exporting}
            onClick={() => void exportCsv()}
            data-testid="export-csv-button"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {selected.size > 0 ? `Export selected (${selected.size})` : 'Export QBO CSV'}
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <ReceiptText className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            {filtersActive
              ? 'No invoices match these filters.'
              : `No invoices for ${monthLabel(year, month)}`}
          </h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {filtersActive
              ? 'Widen the filters to see the whole month.'
              : 'Run the monthly generation to create drafts from the services templates.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-9 px-3" />
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Invoice</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Client</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Period</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Total</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Due</TableHead>
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Sent / Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid="invoice-row"
                  data-invoice-id={row.id}
                  data-status={row.status}
                  className="h-11 cursor-pointer"
                  onClick={() => router.push(`/invoices/${row.id}`)}
                >
                  <TableCell className="px-3 py-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${row.invoiceNumber}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={(v) => toggleSelected(row.id, v === true)}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="tnum whitespace-nowrap text-sm font-medium text-foreground">
                      {row.invoiceNumber}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-52 px-3 py-0">
                    <span className="truncate text-sm text-foreground">{row.clientName}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    {row.year != null && row.month != null ? (
                      <span className="tnum shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {monthLabel(row.year, row.month)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Ad hoc</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <InvoiceStatusChip status={row.status} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      'tnum px-3 py-0 text-right text-sm',
                      row.total.startsWith('-') ? 'font-bold text-money-negative' : TOTAL_TONE[row.status],
                    )}
                  >
                    {moneyLabel(row.total)}
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <DueCell row={row} today={today} />
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
                      {row.sentLabel ?? 'Not sent'}
                      {row.paidLabel ? ` · ${row.paidLabel}` : ''}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
