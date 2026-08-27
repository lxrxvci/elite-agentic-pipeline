import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { quickbooksCsvAction } from '@/server/actions/invoices'

import { InvoicesTable } from '../invoices-table'
import type { InvoiceListRow } from '../view-model'

vi.mock('@/server/actions/invoices', () => ({
  quickbooksCsvAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockCsv = vi.mocked(quickbooksCsvAction)

function row(partial: Partial<InvoiceListRow> & Pick<InvoiceListRow, 'id' | 'status' | 'clientId'>): InvoiceListRow {
  return {
    invoiceNumber: `INV-202608-${partial.id}`,
    clientName: partial.clientId === 1 ? 'Harborline Marine Supply' : 'Blue Spruce Landscaping',
    year: 2026,
    month: 8,
    issueDate: '2026-08-01',
    dueDate: '2026-08-16',
    total: '1250.00',
    sentLabel: null,
    paidLabel: null,
    ...partial,
  }
}

const rows: InvoiceListRow[] = [
  row({ id: 11, clientId: 1, status: 'draft' }),
  row({ id: 12, clientId: 1, status: 'sent', sentLabel: 'Aug 2, 2026', total: '275.00' }),
  row({ id: 13, clientId: 2, status: 'paid', sentLabel: 'Aug 2, 2026', paidLabel: 'Aug 9, 2026' }),
  row({ id: 14, clientId: 2, status: 'overdue', dueDate: '2026-07-16', year: 2026, month: 7 }),
  row({ id: 15, clientId: 2, status: 'void' }),
]

beforeEach(() => {
  mockCsv.mockReset()
  // Radix Select needs these in jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  // jsdom has no object URLs; the download helper calls them.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

async function pickSelectOption(user: ReturnType<typeof userEvent.setup>, triggerLabel: string, option: string) {
  await user.click(screen.getByLabelText(triggerLabel))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('InvoicesTable', () => {
  it('renders every row with right-aligned money, period chip, and status chip', () => {
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    expect(screen.getAllByTestId('invoice-row')).toHaveLength(5)
    expect(screen.getByText('INV-202608-11')).toBeInTheDocument()
    expect(screen.getAllByText('$1,250.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$275.00')).toBeInTheDocument()
    // Sent row shows the muted sent date.
    expect(screen.getAllByText(/Aug 2, 2026/).length).toBeGreaterThan(0)
    // Paid row shows the paid date too.
    expect(screen.getByText(/Aug 9, 2026/)).toBeInTheDocument()
  })

  it('flags overdue aging in the danger token with text, never color alone', () => {
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    const overdueRow = screen.getAllByTestId('invoice-row').find((el) => el.dataset.status === 'overdue')
    expect(overdueRow).toBeTruthy()
    const aging = Array.from(overdueRow!.querySelectorAll('span')).find((el) =>
      el.textContent?.includes('overdue'),
    )
    expect(aging?.textContent).toMatch(/\d+d overdue/)
    expect(aging?.className).toContain('text-status-overdue')
  })

  it('filters by status', async () => {
    const user = userEvent.setup()
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    await pickSelectOption(user, 'Filter by status', 'Paid')
    const visible = screen.getAllByTestId('invoice-row')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveAttribute('data-status', 'paid')
    // Clearing brings everything back.
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getAllByTestId('invoice-row')).toHaveLength(5)
  })

  it('filters by client', async () => {
    const user = userEvent.setup()
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    await pickSelectOption(user, 'Filter by client', 'Harborline Marine Supply')
    const visible = screen.getAllByTestId('invoice-row')
    expect(visible).toHaveLength(2)
    expect(screen.queryByText('INV-202608-13')).not.toBeInTheDocument()
  })

  it('exports the whole non-void month when nothing is selected', async () => {
    mockCsv.mockResolvedValue({ ok: true, data: 'Invoice No,...\n' })
    const user = userEvent.setup()
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    await user.click(screen.getByTestId('export-csv-button'))
    await waitFor(() => expect(mockCsv).toHaveBeenCalledWith([11, 12, 13, 14]))
  })

  it('exports only the selected invoices when rows are checked', async () => {
    mockCsv.mockResolvedValue({ ok: true, data: 'Invoice No,...\n' })
    const user = userEvent.setup()
    render(<InvoicesTable rows={rows} year={2026} month={8} today="2026-08-24" />)
    await user.click(screen.getByLabelText('Select INV-202608-15'))
    await user.click(screen.getByTestId('export-csv-button'))
    await waitFor(() => expect(mockCsv).toHaveBeenCalledWith([15]))
  })
})
