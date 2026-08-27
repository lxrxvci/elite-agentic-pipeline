import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PortalInvoiceItem } from '@/server/portal-invoices'

import { PortalInvoicesList } from '../invoices-list'

/**
 * Portal invoices (HANDOFF §12): read-only non-draft list - number, period,
 * due date, tnum total, and a status chip (never color alone).
 */

const INVOICES: PortalInvoiceItem[] = [
  {
    id: 2,
    invoiceNumber: 'INV-2026-0002',
    status: 'sent',
    year: 2026,
    month: 8,
    issueDate: '2026-08-01',
    dueDate: '2026-08-16',
    total: '485.00',
    sentAt: '2026-08-01T09:00:00.000Z',
    paidAt: null,
  },
  {
    id: 4,
    invoiceNumber: 'INV-2026-0004',
    status: 'overdue',
    year: 2026,
    month: 6,
    issueDate: '2026-06-01',
    dueDate: '2026-06-16',
    total: '640.00',
    sentAt: '2026-06-01T09:00:00.000Z',
    paidAt: null,
  },
  {
    id: 1,
    invoiceNumber: 'INV-2026-0001',
    status: 'paid',
    year: 2026,
    month: 6,
    issueDate: '2026-06-01',
    dueDate: '2026-06-16',
    total: '485.00',
    sentAt: '2026-06-01T09:00:00.000Z',
    paidAt: '2026-06-12T09:00:00.000Z',
  },
]

describe('PortalInvoicesList', () => {
  it('renders each invoice with period, due date, tnum total, and status chip', () => {
    render(<PortalInvoicesList invoices={INVOICES} />)

    const rows = screen.getAllByTestId('portal-invoice-row')
    expect(rows).toHaveLength(3)

    const sent = rows[0]
    expect(sent).toHaveAttribute('data-status', 'sent')
    expect(within(sent).getByText('INV-2026-0002')).toBeInTheDocument()
    expect(within(sent).getByText('Aug 2026')).toBeInTheDocument()
    expect(within(sent).getByText('Aug 16')).toBeInTheDocument()
    expect(within(sent).getByText('$485.00')).toBeInTheDocument()
    expect(within(sent).getByText('Sent')).toBeInTheDocument()

    expect(rows[1]).toHaveAttribute('data-status', 'overdue')
    expect(within(rows[1]).getByText('Overdue')).toBeInTheDocument()
    expect(rows[2]).toHaveAttribute('data-status', 'paid')
    expect(within(rows[2]).getByText('Paid')).toBeInTheDocument()
  })

  it('shows the empty state when there is nothing to list', () => {
    render(<PortalInvoicesList invoices={[]} />)
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
    expect(screen.queryByTestId('portal-invoices-table')).not.toBeInTheDocument()
  })
})
