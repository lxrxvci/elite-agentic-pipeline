import type { InvoiceStatus } from './format'

/**
 * View models for the Invoices surfaces. Money is always a numeric string
 * straight from Postgres - the client never does float math, it only
 * formats for display.
 */

export interface InvoiceListRow {
  id: number
  invoiceNumber: string
  clientId: number
  clientName: string
  status: InvoiceStatus
  year: number | null
  month: number | null
  issueDate: string | null
  dueDate: string | null
  /** Numeric string, e.g. "1240.00". */
  total: string
  /** Display-ready ("Aug 16, 2026") or null. */
  sentLabel: string | null
  paidLabel: string | null
}

/** One client row of the monthly billing-run grid. */
export interface BillingRunGridRow {
  clientId: number
  clientName: string
  /** Invoice state for the viewed month; 'not_yet' when nothing generated. */
  state: InvoiceStatus | 'not_yet'
  invoiceId: number | null
  /** Numeric string; null when no invoice exists. */
  total: string | null
}

export interface PendingTaskRow {
  taskId: number
  clientId: number
  clientName: string
  title: string
  /** Display-ready date ("Aug 20, 2026") or null. */
  completedLabel: string | null
  /** Numeric string from the originating recurring rule; null = unpriced. */
  unitPrice: string | null
}

/** Phase 3C: a billable meeting that has happened but is not invoiced yet. */
export interface PendingMeetingRow {
  meetingId: number
  clientId: number
  clientName: string
  title: string
  /** Display-ready firm-local start ("Aug 18, 2026"). */
  startLabel: string
  /** Numeric string from the meeting's explicit amount; null = unpriced. */
  amount: string | null
}

export interface EmployeeBillingViewRow {
  bookkeeperName: string
  invoiceCount: number
  /** Numeric string. */
  total: string
}

export interface InvoiceLineView {
  id: number
  lineType: string
  description: string
  /** Numeric strings. */
  quantity: string
  unitPrice: string
  amount: string
}

export interface InvoiceDetailView {
  id: number
  invoiceNumber: string
  clientId: number
  clientName: string
  status: InvoiceStatus
  year: number | null
  month: number | null
  issueDate: string | null
  dueDate: string | null
  /** Numeric strings, computed server-side from the line items. */
  subtotal: string
  discount: string
  total: string
  createdLabel: string | null
  sentLabel: string | null
  paidLabel: string | null
  voidedLabel: string | null
  lines: InvoiceLineView[]
}
