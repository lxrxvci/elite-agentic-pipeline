import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'

import { fullDateLabel, moneyLabel } from '@/components/clients/format'
import { lineTypeLabel } from '@/components/invoices/format'
import { InvoiceDetailActions } from '@/components/invoices/invoice-detail-actions'
import { InvoiceStatusChip } from '@/components/invoices/invoice-status-chip'
import type { InvoiceDetailView } from '@/components/invoices/view-model'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db'
import { clients, invoiceLineItems, invoices } from '@/db/schema'
import { AuthError, requireRole } from '@/server/auth/guards'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

export const metadata: Metadata = { title: 'FirmOS - Invoice' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

const tsFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function tsLabel(d: Date | null): string | null {
  return d ? tsFormatter.format(d) : null
}

function TotalsRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const negative = value.startsWith('-')
  return (
    <div className="flex items-baseline justify-between gap-8">
      <dt className={cn('text-xs', strong ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tnum',
          strong
            ? 'font-display text-lg font-bold tracking-tight'
            : 'text-sm font-medium text-foreground',
          strong && !negative && 'text-money-strong',
          negative && 'text-money-negative',
        )}
      >
        {moneyLabel(value)}
      </dd>
    </div>
  )
}

/**
 * Invoice detail (HANDOFF §7): header with the status action matrix, a
 * totals card, the itemized line table, and the timestamp trail. Guarded
 * to manager+; unauthorized users are bounced to the list, which renders
 * its own refusal.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: rawId } = await params
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  try {
    await requireRole('owner', 'admin', 'manager')
  } catch (error) {
    if (error instanceof AuthError) notFound()
    throw error
  }

  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      year: invoices.year,
      month: invoices.month,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      sentAt: invoices.sentAt,
      paidAt: invoices.paidAt,
      voidedAt: invoices.voidedAt,
      createdAt: invoices.createdAt,
      clientId: clients.id,
      clientName: clients.legalName,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, id))
    .limit(1)
  if (!row) notFound()

  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id))
    .orderBy(asc(invoiceLineItems.position))

  // Totals card: negative lines (the aggregated discount) split out of the
  // subtotal. Money stays in numeric strings until the render formats it.
  let subtotalCents = 0
  let discountCents = 0
  for (const l of lines) {
    const cents = Math.round(Number(l.amount) * 100)
    if (cents < 0) discountCents += cents
    else subtotalCents += cents
  }

  const invoice: InvoiceDetailView = {
    id: row.id,
    invoiceNumber: row.invoiceNumber ?? `INV-${row.id}`,
    clientId: row.clientId,
    clientName: row.clientName,
    status: row.status,
    year: row.year,
    month: row.month,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    subtotal: (subtotalCents / 100).toFixed(2),
    discount: (discountCents / 100).toFixed(2),
    total: row.total ?? '0.00',
    createdLabel: tsLabel(row.createdAt),
    sentLabel: tsLabel(row.sentAt),
    paidLabel: tsLabel(row.paidAt),
    voidedLabel: tsLabel(row.voidedAt),
    lines: lines.map((l) => ({
      id: l.id,
      lineType: l.lineType,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
    })),
  }

  const timestamps: { label: string; value: string | null }[] = [
    { label: 'Created', value: invoice.createdLabel },
    { label: 'Sent', value: invoice.sentLabel },
    { label: 'Paid', value: invoice.paidLabel },
    ...(invoice.voidedLabel ? [{ label: 'Voided', value: invoice.voidedLabel }] : []),
  ]

  return (
    <div className="space-y-5 pb-10">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All invoices
      </Link>

      {/* Header */}
      <header className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="tnum font-display text-xl font-semibold tracking-tight text-foreground">
                {invoice.invoiceNumber}
              </h1>
              <InvoiceStatusChip status={invoice.status} size="md" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <Link
                href={`/clients/${invoice.clientId}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {invoice.clientName}
              </Link>
              {invoice.year != null && invoice.month != null && (
                <>
                  {' · '}
                  {monthLabel(invoice.year, invoice.month)}
                </>
              )}
              {invoice.dueDate && <> · Due {fullDateLabel(invoice.dueDate)} (Net 15)</>}
            </p>
            <InvoiceDetailActions
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              status={invoice.status}
            />
          </div>

          {/* Totals card */}
          <dl className="w-56 shrink-0 space-y-1.5 rounded-lg border border-border bg-muted/50 px-4 py-3">
            <TotalsRow label="Subtotal" value={invoice.subtotal} />
            <TotalsRow label="Discount" value={invoice.discount} />
            <div className="border-t border-border pt-1.5">
              <TotalsRow label="Total" value={invoice.total} strong />
            </div>
          </dl>
        </div>
      </header>

      {/* Line items */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Type</TableHead>
              <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Description</TableHead>
              <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Qty</TableHead>
              <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">Rate</TableHead>
              <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lines.map((line) => {
              const negative = line.amount.startsWith('-')
              return (
                <TableRow key={line.id} className="h-11" data-testid="invoice-line">
                  <TableCell className="px-4 py-0">
                    <Badge variant="secondary" className="text-[10px] font-semibold uppercase tracking-wide">
                      {lineTypeLabel(line.lineType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="text-sm text-foreground">{line.description}</span>
                  </TableCell>
                  <TableCell className="tnum px-3 py-0 text-right text-sm text-muted-foreground">
                    {line.quantity}
                  </TableCell>
                  <TableCell className="tnum px-3 py-0 text-right text-sm text-muted-foreground">
                    {moneyLabel(line.unitPrice)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'tnum px-4 py-0 text-right text-sm font-semibold',
                      negative ? 'text-money-negative' : 'text-foreground',
                    )}
                  >
                    {moneyLabel(line.amount)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="h-11">
              <TableCell colSpan={4} className="px-4 py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </TableCell>
              <TableCell
                className={cn(
                  'tnum px-4 py-0 text-right text-sm font-bold',
                  invoice.total.startsWith('-') ? 'text-money-negative' : 'text-money-strong',
                )}
              >
                {moneyLabel(invoice.total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Timestamp trail */}
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-xs" data-testid="invoice-timestamps">
        {timestamps.map((t) => (
          <div key={t.label} className="flex items-baseline gap-1.5">
            <dt className="font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</dt>
            <dd className={cn('tnum', t.value ? 'text-foreground' : 'text-muted-foreground')}>
              {t.value ?? 'Not yet'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
