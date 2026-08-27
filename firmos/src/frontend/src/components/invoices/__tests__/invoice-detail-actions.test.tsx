import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markInvoicePaidAction,
  quickbooksCsvAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from '@/server/actions/invoices'

import type { InvoiceStatus } from '../format'
import { InvoiceDetailActions } from '../invoice-detail-actions'

vi.mock('@/server/actions/invoices', () => ({
  markInvoicePaidAction: vi.fn(),
  quickbooksCsvAction: vi.fn(),
  sendInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockSend = vi.mocked(sendInvoiceAction)
const mockPaid = vi.mocked(markInvoicePaidAction)
const mockVoid = vi.mocked(voidInvoiceAction)

beforeEach(() => {
  vi.clearAllMocks()
})

function renderActions(status: InvoiceStatus) {
  return render(
    <InvoiceDetailActions invoiceId={42} invoiceNumber="INV-202608-1" status={status} />,
  )
}

/**
 * The status action matrix (HANDOFF §7):
 * draft -> Send + Void; sent -> Mark paid + Void + CSV; overdue -> Mark
 * paid + CSV; paid -> CSV only; void -> nothing.
 */
describe('InvoiceDetailActions matrix', () => {
  it('draft: Send + Void, no CSV, no Mark paid', () => {
    renderActions('draft')
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'QBO CSV' })).not.toBeInTheDocument()
  })

  it('sent: Mark paid + Void + QBO CSV, no Send', () => {
    renderActions('sent')
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QBO CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('overdue: Mark paid + QBO CSV, no Send, no Void', () => {
    renderActions('overdue')
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QBO CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('paid: QBO CSV only', () => {
    renderActions('paid')
    expect(screen.getByRole('button', { name: 'QBO CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('void: no actions at all', () => {
    const { container } = renderActions('void')
    expect(container).toBeEmptyDOMElement()
  })
})

describe('InvoiceDetailActions confirms', () => {
  it('Send is a confirm dialog that calls sendInvoiceAction', async () => {
    mockSend.mockResolvedValue({ ok: true, data: { invoiceId: 42, status: 'sent' } })
    const user = userEvent.setup()
    renderActions('draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const dialog = await screen.findByTestId('invoice-action-dialog')
    expect(dialog).toHaveTextContent('Send this invoice?')
    expect(mockSend).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Send invoice' }))
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(42))
  })

  it('Mark paid is a confirm dialog that calls markInvoicePaidAction', async () => {
    mockPaid.mockResolvedValue({ ok: true, data: { invoiceId: 42, status: 'paid' } })
    const user = userEvent.setup()
    renderActions('sent')
    await user.click(screen.getByRole('button', { name: 'Mark paid' }))

    const dialog = await screen.findByTestId('invoice-action-dialog')
    expect(dialog).toHaveTextContent('Mark this invoice paid?')
    await user.click(within(dialog).getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(mockPaid).toHaveBeenCalledWith(42))
  })

  it('Void is a confirm dialog that calls voidInvoiceAction', async () => {
    mockVoid.mockResolvedValue({ ok: true, data: { invoiceId: 42, status: 'void' } })
    const user = userEvent.setup()
    renderActions('draft')
    await user.click(screen.getByRole('button', { name: 'Void' }))
    await user.click(await screen.findByRole('button', { name: 'Void invoice' }))
    await waitFor(() => expect(mockVoid).toHaveBeenCalledWith(42))
  })
})
