'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, ReceiptText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { InvoiceStatusChip } from '@/components/invoices/invoice-status-chip'
import type { InvoiceStatus } from '@/components/invoices/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { resyncClientBillingAction } from '@/server/actions/invoices'
import type { ClientBilling } from '@/server/clients'
import { monthLabel } from '@/shared/lib/date-display'

import { cadenceLabel, fullDateLabel, moneyLabel } from './format'

/**
 * Billing tab (admin/owner only - the server read is role-guarded, so this
 * panel only ever renders with authorized data). Services template line
 * items renormalized to monthly amounts, plus the cached legacy amounts.
 */

/** Recent invoice summary for the Invoices sub-section. */
export interface ClientInvoiceRef {
  id: number
  invoiceNumber: string
  status: InvoiceStatus
  year: number | null
  month: number | null
  /** Numeric string from Postgres - formatted, never computed on. */
  total: string
  dueDate: string | null
}

interface BillingPanelProps {
  billing: ClientBilling
  clientId: number
  invoices: ClientInvoiceRef[]
}

function CachedAmount({ label, value, unset }: { label: string; value: string; unset?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className={
          unset
            ? 'mt-0.5 text-sm text-muted-foreground'
            : 'tnum mt-0.5 text-sm font-semibold text-foreground'
        }
      >
        {value}
      </div>
    </div>
  )
}

export function BillingPanel({ billing, clientId, invoices }: BillingPanelProps) {
  return (
    <div className="space-y-4">
      {/* Cached amounts + billing settings + resync */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          <CachedAmount
            label="Monthly recurring"
            value={billing.monthlyRecurringAmount != null ? moneyLabel(billing.monthlyRecurringAmount) : 'Not set'}
            unset={billing.monthlyRecurringAmount == null}
          />
          <CachedAmount
            label="Base monthly"
            value={billing.baseMonthlyAmount != null ? moneyLabel(billing.baseMonthlyAmount) : 'Not set'}
            unset={billing.baseMonthlyAmount == null}
          />
          <CachedAmount
            label="Per-account price"
            value={billing.perAccountPrice != null ? moneyLabel(billing.perAccountPrice) : 'Not set'}
            unset={billing.perAccountPrice == null}
          />
          <CachedAmount
            label="Billing cadence"
            value={`${cadenceLabel(billing.billingFrequency)}${billing.isAutoPay ? ' · AutoPay' : ''}`}
          />
        </div>
        <ResyncButton clientId={clientId} lastSyncedAt={billing.billingLastSyncedAt} />
      </div>

      {billing.lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <ReceiptText className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No services template yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            The recurring services template is built from the intake quote. Once it exists,
            every line item invoices from here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                  Product
                </TableHead>
                <TableHead className="tnum h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Qty
                </TableHead>
                <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Unit price
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Frequency
                </TableHead>
                <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Monthly amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.lines.map((line) => (
                <TableRow key={line.serviceKey} className="h-11" data-testid="billing-line">
                  <TableCell className="px-4 py-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {line.productName}
                      </span>
                      {line.manualEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Manual
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Hand-edited line - preserved across template rebuilds
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {line.notes && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-xs text-muted-foreground">Note</span>
                          </TooltipTrigger>
                          <TooltipContent>{line.notes}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tnum px-3 py-0 text-right text-sm text-muted-foreground">
                    {line.quantity}
                  </TableCell>
                  <TableCell className="tnum px-3 py-0 text-right text-sm text-muted-foreground">
                    {moneyLabel(line.unitPrice)}
                  </TableCell>
                  <TableCell className="px-3 py-0 text-xs text-muted-foreground">
                    {cadenceLabel(line.frequency)}
                  </TableCell>
                  <TableCell className="tnum px-4 py-0 text-right text-sm font-semibold text-foreground">
                    {moneyLabel(line.monthlyAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="h-11">
                <TableCell colSpan={4} className="px-4 py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Monthly total
                </TableCell>
                <TableCell className="tnum px-4 py-0 text-right text-sm font-bold text-foreground">
                  {moneyLabel(billing.monthlyTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <ClientInvoicesSection invoices={invoices} />
    </div>
  )
}

/** The resynced-at stamp, display-only (ISO timestamp -> short label). */
function syncedLabel(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

/**
 * Rebuild the services template from live state (HANDOFF §29). The confirm
 * dialog is explicit: hand-edited lines survive, the rest rebuilds. The
 * stamp comes from the server-computed billingLastSyncedAt.
 */
function ResyncButton({ clientId, lastSyncedAt }: { clientId: number; lastSyncedAt: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function resync() {
    setPending(true)
    const res = await resyncClientBillingAction(clientId)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Billing template resynced', {
      description: `${res.data.lineCount} lines · ${res.data.manualLinesKept} manual edits kept`,
    })
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
        data-testid="resync-billing-button"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Resync from live state
      </Button>
      <span className="tnum text-[10px] text-muted-foreground" data-testid="resynced-at">
        {lastSyncedAt ? `Last synced ${syncedLabel(lastSyncedAt)}` : 'Never synced'}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resync billing from live state?</DialogTitle>
            <DialogDescription>
              The services template rebuilds from the client&apos;s live accounts,
              properties, and service answers.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
            <li>Quantities and counts are recomputed from what exists right now.</li>
            <li>Hand-edited lines (marked Manual) are preserved exactly as they are.</li>
            <li>Invoices already generated are not touched.</li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={() => void resync()}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Resync template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Recent invoices for this client, linking through to /invoices/[id]. */
function ClientInvoicesSection({ invoices }: { invoices: ClientInvoiceRef[] }) {
  return (
    <section aria-label="Client invoices" className="space-y-2">
      <h3 className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Invoices
        <span className="tnum font-semibold">{invoices.length}</span>
      </h3>
      {invoices.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-4 text-xs text-muted-foreground">
          No invoices yet - they appear here after the monthly billing run.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wider">Invoice</TableHead>
                <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Period</TableHead>
                <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Due</TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id} className="h-10" data-testid="client-invoice-row">
                  <TableCell className="px-4 py-0">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="tnum whitespace-nowrap text-sm font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    {inv.year != null && inv.month != null ? (
                      <span className="tnum shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {monthLabel(inv.year, inv.month)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Ad hoc</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <InvoiceStatusChip status={inv.status} />
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
                      {inv.dueDate ? fullDateLabel(inv.dueDate) : 'No due date'}
                    </span>
                  </TableCell>
                  <TableCell className="tnum px-4 py-0 text-right text-sm font-semibold text-foreground">
                    {moneyLabel(inv.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
