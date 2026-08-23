import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/shared/lib/test-utils'
import ClientsPage from './clients'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const useClientsMock = vi.fn()
vi.mock('@/features/clients/api/useClients', () => ({ useClients: () => useClientsMock() }))

describe('ClientsPage', () => {
  beforeEach(() => {
    useClientsMock.mockReset()
  })

  it('renders loading state', () => {
    useClientsMock.mockReturnValue({ data: undefined, isLoading: true })
    render(<ClientsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders a list of clients', () => {
    useClientsMock.mockReturnValue({
      data: {
        items: [
          { id: 'c1', name: 'Acme', email: 'acme@example.com', currency: 'USD', default_hourly_rate: 100 },
          { id: 'c2', name: 'Globex', currency: 'EUR' },
        ],
        total: 2,
      },
      isLoading: false,
    })
    render(<ClientsPage />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Currency: USD · 100/hr')).toBeInTheDocument()
    expect(screen.getByText('Currency: EUR')).toBeInTheDocument()
  })

  it('renders empty state when no clients', () => {
    useClientsMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
    render(<ClientsPage />)
    expect(screen.getByText('No clients yet')).toBeInTheDocument()
  })
})
