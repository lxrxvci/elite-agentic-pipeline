import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import InvoicesPage from './invoices'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const useInvoicesMock = vi.fn()
vi.mock('@/features/invoices/api/useInvoices', () => ({ useInvoices: () => useInvoicesMock() }))

describe('InvoicesPage', () => {
  beforeEach(() => {
    useInvoicesMock.mockReset()
  })

  it('renders loading state', () => {
    useInvoicesMock.mockReturnValue({ data: undefined, isLoading: true })
    render(<InvoicesPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders invoices', () => {
    useInvoicesMock.mockReturnValue({
      data: {
        items: [
          {
            id: 'i1',
            status: 'sent',
            issue_date: '2024-01-01',
            due_date: '2024-01-15',
            total: { amount: 100, currency: 'USD' },
            client_id: 'Acme',
          },
        ],
        total: 1,
      },
      isLoading: false,
    })
    render(<InvoicesPage />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('USD 100')).toBeInTheDocument()
  })

  it('renders empty state when no invoices', () => {
    useInvoicesMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
    render(<InvoicesPage />)
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
  })
})
