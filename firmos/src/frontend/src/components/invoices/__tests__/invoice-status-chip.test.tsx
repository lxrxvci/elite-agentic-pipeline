import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { InvoiceStatus } from '../format'
import { InvoiceStatusChip } from '../invoice-status-chip'

/**
 * The status chip is the color contract: every invoice status renders the
 * same dot token + text label on every surface (data-status is the token).
 */
describe('InvoiceStatusChip', () => {
  const cases: [InvoiceStatus, string, string][] = [
    ['draft', 'due_soon', 'Draft'],
    ['sent', 'waiting_client', 'Sent'],
    ['paid', 'on_track', 'Paid'],
    ['overdue', 'overdue', 'Overdue'],
    ['void', 'on_hold', 'Void'],
  ]

  it.each(cases)('%s renders the %s token with its label', (status, token, label) => {
    render(<InvoiceStatusChip status={status} />)
    const chip = screen.getByText(label)
    expect(chip.closest('[data-status]')).toHaveAttribute('data-status', token)
  })
})
