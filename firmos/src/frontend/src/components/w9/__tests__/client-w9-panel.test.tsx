import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ClientW9Panel,
  W9_STATUS_META,
  effectiveNeeds1099,
  w9ActionsFor,
  w9SummaryOf,
  type W9RecipientItem,
  type W9Status,
} from '../client-w9-panel'

vi.mock('@/server/actions/w9', () => ({
  createW9RecipientAction: vi.fn(),
  updateW9RecipientAction: vi.fn(),
  emailW9RequestAction: vi.fn(),
  exportOregonCsvAction: vi.fn(),
  mark1099SentAction: vi.fn(),
  markW9ReceivedAction: vi.fn(),
  uploadW9DocumentAction: vi.fn(),
}))

const recipient = (
  partial: Partial<W9RecipientItem> & Pick<W9RecipientItem, 'id' | 'vendorName' | 'status'>,
): W9RecipientItem => ({
  email: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  zip: null,
  taxId: null,
  totalPaid: '0',
  paymentType: null,
  needs1099ManualOverride: null,
  w9RequestedAt: null,
  w9ReceivedDate: null,
  form1099SentDate: null,
  w9DocumentId: null,
  ...partial,
})

describe('W9_STATUS_META', () => {
  it('maps each status to a 6-token status and a label (never color-alone)', () => {
    expect(W9_STATUS_META.pending_w9).toEqual({ status: 'waiting_client', label: 'W-9 pending' })
    expect(W9_STATUS_META.w9_received).toEqual({ status: 'due_soon', label: 'W-9 received' })
    expect(W9_STATUS_META['1099_sent']).toEqual({ status: 'on_track', label: '1099 sent' })
  })
})

describe('w9ActionsFor', () => {
  it('pending_w9: mark received, upload, email request; no 1099 send', () => {
    expect(w9ActionsFor('pending_w9')).toEqual({
      canMarkReceived: true,
      canMarkSent: false,
      canUpload: true,
      canEmailRequest: true,
    })
  })

  it('w9_received: mark 1099 sent + upload; no re-request', () => {
    expect(w9ActionsFor('w9_received')).toEqual({
      canMarkReceived: false,
      canMarkSent: true,
      canUpload: true,
      canEmailRequest: false,
    })
  })

  it('1099_sent: terminal - no workflow actions remain', () => {
    expect(w9ActionsFor('1099_sent')).toEqual({
      canMarkReceived: false,
      canMarkSent: false,
      canUpload: false,
      canEmailRequest: false,
    })
  })
})

describe('effectiveNeeds1099 / w9SummaryOf', () => {
  it('manual override wins over the $600 threshold', () => {
    expect(effectiveNeeds1099({ totalPaid: '1500', needs1099ManualOverride: false })).toBe(false)
    expect(effectiveNeeds1099({ totalPaid: '100', needs1099ManualOverride: true })).toBe(true)
    expect(effectiveNeeds1099({ totalPaid: '600', needs1099ManualOverride: null })).toBe(true)
    expect(effectiveNeeds1099({ totalPaid: '599.99', needs1099ManualOverride: null })).toBe(false)
  })

  it('summarizes counts per status and total paid', () => {
    const summary = w9SummaryOf([
      recipient({ id: 1, vendorName: 'A', status: 'pending_w9', totalPaid: '700' }),
      recipient({ id: 2, vendorName: 'B', status: 'w9_received', totalPaid: '300' }),
      recipient({ id: 3, vendorName: 'C', status: '1099_sent', totalPaid: '1200' }),
    ])
    expect(summary).toEqual({
      total: 3,
      pendingW9: 1,
      w9Received: 1,
      sent1099: 1,
      needs1099: 2,
      totalPaidAll: 2200,
    })
  })
})

describe('ClientW9Panel rows', () => {
  const rows: W9RecipientItem[] = [
    recipient({ id: 1, vendorName: 'Cascade Print Co', status: 'pending_w9', totalPaid: '2400' }),
    recipient({ id: 2, vendorName: 'Dusk IT Services', status: 'w9_received', totalPaid: '900', w9DocumentId: 44 }),
    recipient({ id: 3, vendorName: 'Elm Couriers', status: '1099_sent', totalPaid: '450', needs1099ManualOverride: false }),
  ]

  function rowFor(name: string, status: W9Status) {
    const row = screen
      .getAllByTestId('w9-row')
      .find((el) => el.textContent?.includes(name) && el.getAttribute('data-status') === status)
    if (!row) throw new Error(`row not found: ${name}`)
    return within(row)
  }

  it('renders status chips per status', () => {
    render(<ClientW9Panel clientId={7} year={2025} recipients={rows} />)
    expect(rowFor('Cascade Print Co', 'pending_w9').getByText('W-9 pending')).toBeInTheDocument()
    expect(rowFor('Dusk IT Services', 'w9_received').getByText('W-9 received')).toBeInTheDocument()
    expect(rowFor('Elm Couriers', '1099_sent').getByText('1099 sent')).toBeInTheDocument()
  })

  it('pending rows offer mark-received / upload / email, not mark-sent', () => {
    render(<ClientW9Panel clientId={7} year={2025} recipients={rows} />)
    const row = rowFor('Cascade Print Co', 'pending_w9')
    expect(row.getByRole('button', { name: 'Mark W-9 received' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Upload W-9 for Cascade Print Co' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Email W-9 request for Cascade Print Co' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Mark 1099 sent' })).not.toBeInTheDocument()
  })

  it('received rows offer mark-sent and the W-9 document link', () => {
    render(<ClientW9Panel clientId={7} year={2025} recipients={rows} />)
    const row = rowFor('Dusk IT Services', 'w9_received')
    expect(row.getByRole('button', { name: 'Mark 1099 sent' })).toBeInTheDocument()
    expect(row.getByRole('link', { name: /W-9/ })).toHaveAttribute('href', '/api/documents/44')
    expect(row.queryByRole('button', { name: 'Mark W-9 received' })).not.toBeInTheDocument()
  })

  it('sent rows keep edit only - workflow actions are gone', () => {
    render(<ClientW9Panel clientId={7} year={2025} recipients={rows} />)
    const row = rowFor('Elm Couriers', '1099_sent')
    expect(row.queryByRole('button', { name: 'Mark 1099 sent' })).not.toBeInTheDocument()
    expect(row.queryByRole('button', { name: /Upload W-9/ })).not.toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Edit Elm Couriers' })).toBeInTheDocument()
    // Override to "No" is rendered as text, not a color.
    expect(row.getByText('(override)')).toBeInTheDocument()
  })

  it('renders the $600 summary card with tabular counts', () => {
    render(<ClientW9Panel clientId={7} year={2025} recipients={rows} />)
    const summary = screen.getByTestId('w9-summary')
    expect(summary).toHaveTextContent('2 of 3 need a 1099 ($600 threshold)')
    expect(summary).toHaveTextContent('1 W-9 pending')
    expect(summary).toHaveTextContent('$3,750.00')
  })
})
