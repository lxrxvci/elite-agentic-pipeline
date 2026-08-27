import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'
import { and, asc, eq } from 'drizzle-orm'
import { formatLocalDate, generatesRecurringWork } from '@firmos/domain'

import {
  InvoicesSurface,
  type InvoiceView,
} from '@/components/invoices/invoices-surface'
import { parsePeriodParam } from '@/components/invoices/format'
import type {
  BillingRunGridRow,
  EmployeeBillingViewRow,
  InvoiceListRow,
  PendingTaskRow,
} from '@/components/invoices/view-model'
import { db } from '@/db'
import { clients, invoices } from '@/db/schema'
import { AuthError, requireRole } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { toDomainClient } from '@/server/domain-adapters'
import {
  byEmployeeBillingReport,
  getPendingBillableTasks,
} from '@/server/invoices'

export const metadata: Metadata = { title: 'FirmOS - Invoices' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/** "Aug 16, 2026" - display-only rendering of a timestamptz instant. */
const tsFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function tsLabel(d: Date | null): string | null {
  return d ? tsFormatter.format(d) : null
}

/** 403-style refusal for staff below manager - the nav item hides too. */
function NoAccess() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-on-hold-bg">
        <ShieldAlert className="h-5 w-5 text-status-on-hold" aria-hidden />
      </span>
      <h1 className="mt-4 text-sm font-semibold text-foreground">Invoices are manager-only</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        Billing surfaces are restricted to managers, admins, and the owner. Ask a
        manager if you need invoice data for a client.
      </p>
    </div>
  )
}

/**
 * The billing run surface (HANDOFF §15). Guarded to manager+ at the page
 * (the actions re-guard every mutation). Reads are plain queries here
 * because the engine exposes no list reader - the engines own mutations,
 * this page owns presentation.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; view?: string }>
}) {
  let user = null
  try {
    user = await requireRole('owner', 'admin', 'manager')
  } catch (error) {
    if (error instanceof AuthError) return <NoAccess />
    throw error
  }
  void user

  const { period, view } = await searchParams
  const today = localToday()
  const parsed = parsePeriodParam(period)
  const year = parsed?.year ?? today.year
  const month = parsed?.month ?? today.month
  const invoiceView: InvoiceView = view === 'grid' ? 'grid' : 'table'

  const [invoiceRows, clientRows, pending, employeeRows] = await Promise.all([
    db
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
        clientId: clients.id,
        clientName: clients.legalName,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.year, year), eq(invoices.month, month)))
      .orderBy(asc(clients.legalName), asc(invoices.id)),
    db.select().from(clients).orderBy(asc(clients.legalName)),
    getPendingBillableTasks(),
    byEmployeeBillingReport(year, month),
  ])

  const rows: InvoiceListRow[] = invoiceRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? `INV-${r.id}`,
    clientId: r.clientId,
    clientName: r.clientName,
    status: r.status,
    year: r.year,
    month: r.month,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    total: r.total ?? '0.00',
    sentLabel: tsLabel(r.sentAt),
    paidLabel: tsLabel(r.paidAt),
  }))

  // The billing-run grid covers every worked client (§6.2 predicate via the
  // domain), so a manager sees who is still missing from the run.
  const invoiceByClient = new Map(rows.map((r) => [r.clientId, r]))
  const gridRows: BillingRunGridRow[] = clientRows
    .filter((c) => generatesRecurringWork(toDomainClient(c)))
    .map((c) => {
      const inv = invoiceByClient.get(c.id)
      return {
        clientId: c.id,
        clientName: c.legalName,
        state: inv ? inv.status : 'not_yet',
        invoiceId: inv?.id ?? null,
        total: inv?.total ?? null,
      }
    })

  const pendingTasks: PendingTaskRow[] = pending.map((t) => ({
    taskId: t.taskId,
    clientId: t.clientId,
    clientName: t.clientName,
    title: t.title,
    completedLabel: tsLabel(t.completedAt),
    unitPrice: t.unitPrice,
  }))

  const employeeViewRows: EmployeeBillingViewRow[] = employeeRows.map((r) => ({
    bookkeeperName: r.bookkeeperName,
    invoiceCount: r.invoiceCount,
    total: r.total,
  }))

  // Picker: twelve months back through one month ahead, always containing
  // the viewed month.
  const monthOptions: { year: number; month: number }[] = []
  for (let offset = -12; offset <= 1; offset += 1) {
    const d = new Date(today.year, today.month - 1 + offset, 1)
    monthOptions.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  if (!monthOptions.some((o) => o.year === year && o.month === month)) {
    monthOptions.push({ year, month })
    monthOptions.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
  }

  return (
    <InvoicesSurface
      rows={rows}
      gridRows={gridRows}
      pendingTasks={pendingTasks}
      employeeRows={employeeViewRows}
      year={year}
      month={month}
      today={formatLocalDate(today)}
      view={invoiceView}
      monthOptions={monthOptions}
    />
  )
}
