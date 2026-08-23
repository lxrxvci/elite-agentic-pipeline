import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import NewInvoicePage from './invoices-new'

const mutateAsyncMock = vi.fn()
const useCreateInvoiceMock = vi.fn()
const useClientsMock = vi.fn()
const useTimeEntriesMock = vi.fn()
vi.mock('@/features/invoices/api/useCreateInvoice', () => ({
  useCreateInvoice: () => useCreateInvoiceMock(),
}))
vi.mock('@/features/clients/api/useClients', () => ({ useClients: () => useClientsMock() }))
vi.mock('@/features/time-entries/api/useTimeEntries', () => ({ useTimeEntries: () => useTimeEntriesMock() }))
vi.mock('@/features/invoices/ui/SelectableTimeEntryGroup', () => ({
  SelectableTimeEntryGroup: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(['t1'])}>Select entry</button>
  ),
}))

describe('NewInvoicePage', () => {
  beforeEach(() => {
    useCreateInvoiceMock.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false })
    useClientsMock.mockReturnValue({
      data: { items: [{ id: 'c1', name: 'Acme' }], total: 1 },
    })
    useTimeEntriesMock.mockReturnValue({
      data: { items: [{ id: 't1', description: 'Design', duration_minutes: 60 }], total: 1 },
    })
    mutateAsyncMock.mockReset()
  })

  it('creates an invoice when client and entries are selected', async () => {
    mutateAsyncMock.mockResolvedValue({ id: 'i1' })
    render(<NewInvoicePage />)

    await userEvent.selectOptions(screen.getByLabelText('Client'), 'c1')
    await userEvent.click(screen.getByRole('button', { name: /select entry/i }))

    await userEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'c1',
        time_entry_ids: ['t1'],
      })
    )
  })

  it('does not submit when no entries are selected', async () => {
    render(<NewInvoicePage />)
    await userEvent.selectOptions(screen.getByLabelText('Client'), 'c1')

    const button = screen.getByRole('button', { name: /create invoice/i })
    expect(button).toBeDisabled()
  })
})
