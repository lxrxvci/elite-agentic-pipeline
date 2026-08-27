import type { WorkStatus } from '@/shared/ui/work'

/**
 * Presentation helpers for the Invoices surfaces.
 *
 * Status color is a contract (docs/DESIGN_MANDATE.md §2): each invoice
 * status maps to exactly one work-status token, identical on the list, the
 * grid, the detail, and the client Billing tab. Never color alone - the
 * chip always pairs a dot with a text label.
 */

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'

export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'void']

const STATUS_CONFIG: Record<InvoiceStatus, { token: WorkStatus; label: string }> = {
  // A draft is work to finish this week.
  draft: { token: 'due_soon', label: 'Draft' },
  // Sent means the ball is with the client.
  sent: { token: 'waiting_client', label: 'Sent' },
  paid: { token: 'on_track', label: 'Paid' },
  overdue: { token: 'overdue', label: 'Overdue' },
  // Void is the archived/terminal neutral.
  void: { token: 'on_hold', label: 'Void' },
}

export function invoiceStatusConfig(status: InvoiceStatus): { token: WorkStatus; label: string } {
  return STATUS_CONFIG[status] ?? { token: 'on_hold', label: status }
}

export type InvoiceLineType = 'recurring' | 'task' | 'quickbooks_subscription' | 'other'

const LINE_TYPE_LABELS: Record<InvoiceLineType, string> = {
  recurring: 'Recurring',
  task: 'Task',
  quickbooks_subscription: 'QBO sub',
  other: 'Other',
}

export function lineTypeLabel(lineType: string): string {
  return LINE_TYPE_LABELS[lineType as InvoiceLineType] ?? 'Other'
}

/** "2026-08" - the period query param and CSV filename fragment. */
export function periodParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Parse a "YYYY-MM" period param; null when malformed. */
export function parsePeriodParam(raw: string | undefined): { year: number; month: number } | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

/** QBO export filenames: the month run or a single invoice (§15). */
export function monthCsvFilename(year: number, month: number): string {
  return `invoices-${periodParam(year, month)}.csv`
}

export function invoiceCsvFilename(invoiceNumber: string, invoiceId: number): string {
  return `invoice-${invoiceNumber || `INV-${invoiceId}`}.csv`
}
