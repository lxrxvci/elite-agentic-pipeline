import { ReceiptText } from 'lucide-react'

import { moneyLabel } from '@/components/clients/format'
import type { PortalInvoiceItem } from '@/server/portal-invoices'
import { dayLabel, periodLabel } from '@/shared/lib/date-display'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

/**
 * Portal invoices (HANDOFF §12): read-only list of non-draft invoices for
 * the acting client. Drafts never reach this list - the engine filters
 * them. Color carries state through the status chip; totals are tnum.
 */

export const PORTAL_INVOICE_STATUS_META: Record<
  PortalInvoiceItem['status'],
  { status: WorkStatus; label: string }
> = {
  sent: { status: 'due_soon', label: 'Sent' },
  paid: { status: 'on_track', label: 'Paid' },
  overdue: { status: 'overdue', label: 'Overdue' },
  void: { status: 'on_hold', label: 'Void' },
}

export function PortalInvoicesList({ invoices }: { invoices: PortalInvoiceItem[] }) {
  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <ReceiptText aria-hidden className="h-5 w-5 text-accent-foreground" />
        </span>
        <p className="mt-3 text-sm font-semibold text-foreground">No invoices yet</p>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          When your firm sends an invoice it shows up here.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm" data-testid="portal-invoices-table">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5">Invoice</th>
            <th className="px-4 py-2.5">Period</th>
            <th className="px-4 py-2.5">Due</th>
            <th className="px-4 py-2.5 text-right">Total</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const meta = PORTAL_INVOICE_STATUS_META[inv.status]
            return (
              <tr
                key={inv.id}
                data-testid="portal-invoice-row"
                data-status={inv.status}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-4 py-2.5 font-medium text-foreground">{inv.invoiceNumber}</td>
                <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                  {periodLabel(inv.year, inv.month)}
                </td>
                <td className="tnum px-4 py-2.5 text-[13px] text-foreground">
                  {inv.dueDate ? dayLabel(inv.dueDate) : '-'}
                </td>
                <td className="tnum px-4 py-2.5 text-right font-medium text-foreground">
                  {moneyLabel(inv.total)}
                </td>
                <td className="px-4 py-2.5">
                  <WorkStatusBadge status={meta.status} label={meta.label} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
