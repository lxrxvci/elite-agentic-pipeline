import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InvoicesHero, invoiceHeroTotals } from '../invoices-hero'
import type { InvoiceListRow } from '../view-model'

function row(partial: Partial<InvoiceListRow> & Pick<InvoiceListRow, 'id' | 'status' | 'total'>): InvoiceListRow {
  return {
    invoiceNumber: `INV-${partial.id}`,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    year: 2026,
    month: 8,
    issueDate: '2026-08-01',
    dueDate: '2026-08-16',
    sentLabel: null,
    paidLabel: null,
    ...partial,
  }
}

const rows: InvoiceListRow[] = [
  row({ id: 1, status: 'draft', total: '1000.00' }),
  row({ id: 2, status: 'sent', total: '400.00' }),
  row({ id: 3, status: 'sent', total: '250.50' }),
  row({ id: 4, status: 'overdue', total: '1200.00' }),
  row({ id: 5, status: 'paid', total: '800.00' }),
  row({ id: 6, status: 'void', total: '9999.00' }),
]

describe('invoiceHeroTotals', () => {
  it('outstanding sums sent + overdue only, in cents integers', () => {
    const totals = invoiceHeroTotals(rows)
    // 400.00 + 250.50 + 1200.00 = 1850.50
    expect(totals.outstandingCents).toBe(185050)
    expect(totals.openCount).toBe(3)
  })

  it('overdue sums the overdue rows only', () => {
    const totals = invoiceHeroTotals(rows)
    expect(totals.overdueCents).toBe(120000)
    expect(totals.overdueCount).toBe(1)
  })

  it('billed sums every non-void row (drafts and paid included, void excluded)', () => {
    const totals = invoiceHeroTotals(rows)
    // 1000 + 400 + 250.50 + 1200 + 800 = 3650.50
    expect(totals.billedCents).toBe(365050)
    expect(totals.billedCount).toBe(5)
  })
})

describe('InvoicesHero', () => {
  it('renders the three hero figures with money formatting and count captions', () => {
    render(<InvoicesHero rows={rows} year={2026} month={8} />)

    const outstanding = within(screen.getByTestId('hero-outstanding'))
    expect(outstanding.getByText('$1,850.50')).toBeInTheDocument()
    expect(outstanding.getByText('3 open invoices to collect')).toBeInTheDocument()

    const overdue = within(screen.getByTestId('hero-overdue'))
    expect(overdue.getByText('$1,200.00')).toBeInTheDocument()
    expect(overdue.getByText('1 invoice past due')).toBeInTheDocument()

    const billed = within(screen.getByTestId('hero-billed'))
    expect(billed.getByText('$3,650.50')).toBeInTheDocument()
    expect(billed.getByText('5 invoices in Aug 2026')).toBeInTheDocument()
  })

  it('the overdue figure carries the danger accent only when something is overdue', () => {
    render(<InvoicesHero rows={rows} year={2026} month={8} />)
    expect(within(screen.getByTestId('hero-overdue')).getByText('$1,200.00')).toHaveClass(
      'text-status-overdue',
    )
  })

  it('a clean month reads neutral, never danger', () => {
    const clean = rows.filter((r) => r.status !== 'overdue')
    render(<InvoicesHero rows={clean} year={2026} month={8} />)
    const overdue = within(screen.getByTestId('hero-overdue'))
    expect(overdue.getByText('$0.00')).not.toHaveClass('text-status-overdue')
    expect(overdue.getByText('Nothing past due')).toBeInTheDocument()
  })
})
