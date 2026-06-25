import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InvoiceCard } from './InvoiceCard'
import type { Invoice } from '@/entities/invoice/model'

const mockInvoice: Invoice = {
  id: 'inv-1',
  tenant_id: 'tenant-1',
  client_id: 'client-1',
  status: 'sent',
  issue_date: '2026-06-01',
  due_date: '2026-06-15',
  notes: null,
  subtotal: { amount: '100.00', currency: 'USD' },
  tax: { amount: '0.00', currency: 'USD' },
  total: { amount: '100.00', currency: 'USD' },
  idempotency_key: null,
  line_items: [],
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

describe('InvoiceCard', () => {
  it('renders invoice total and dates', () => {
    render(<InvoiceCard invoice={mockInvoice} />)
    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    expect(screen.getByText(/Issued 2026-06-01/)).toBeInTheDocument()
    expect(screen.getByText(/Due 2026-06-15/)).toBeInTheDocument()
  })

  it('renders client name when provided', () => {
    render(<InvoiceCard invoice={mockInvoice} clientName="Acme Corp" />)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('renders client id fallback when client name is missing', () => {
    render(<InvoiceCard invoice={mockInvoice} />)
    expect(screen.getByText('client-1')).toBeInTheDocument()
  })

  it('renders status badge', () => {
    render(<InvoiceCard invoice={mockInvoice} />)
    expect(screen.getByText('Sent')).toBeInTheDocument()
  })
})
