import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import InvoiceDetailPage from './invoice-detail'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'i1' }),
  usePathname: () => '/invoices/i1',
}))

vi.mock('@/features/invoices/ui/RecordPaymentDialog', () => ({
  RecordPaymentDialog: () => <div data-testid="payment-dialog" />,
}))

const useInvoiceMock = vi.fn()
vi.mock('@/features/invoices/api/useInvoice', () => ({ useInvoice: (id: string) => useInvoiceMock(id) }))

describe('InvoiceDetailPage', () => {
  beforeEach(() => {
    useInvoiceMock.mockReset()
  })

  it('renders loading state', () => {
    useInvoiceMock.mockReturnValue({ data: undefined, isLoading: true })
    render(<InvoiceDetailPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders invoice details and record payment button', () => {
    useInvoiceMock.mockReturnValue({
      data: {
        id: 'i1',
        status: 'overdue',
        issue_date: '2024-01-01',
        due_date: '2024-01-15',
        total: { amount: 250, currency: 'USD' },
        notes: 'Net 15',
        line_items: [],
      },
      isLoading: false,
    })
    render(<InvoiceDetailPage />)
    expect(screen.getAllByText('USD 250').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Net 15')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument()
  })

  it('does not show record payment for paid invoices', () => {
    useInvoiceMock.mockReturnValue({
      data: {
        id: 'i1',
        status: 'paid',
        issue_date: '2024-01-01',
        due_date: '2024-01-15',
        total: { amount: 250, currency: 'USD' },
        line_items: [],
      },
      isLoading: false,
    })
    render(<InvoiceDetailPage />)
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument()
  })

  it('renders not found when invoice is missing', () => {
    useInvoiceMock.mockReturnValue({ data: undefined, isLoading: false })
    render(<InvoiceDetailPage />)
    expect(screen.getByText('Invoice not found.')).toBeInTheDocument()
  })
})
