import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PendingBillableMeetings } from '../pending-billable-meetings'
import type { PendingMeetingRow } from '../view-model'

const rows: PendingMeetingRow[] = [
  {
    meetingId: 601,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: 'August close review',
    startLabel: 'Aug 10, 2026',
    amount: '150.00',
  },
  {
    meetingId: 602,
    clientId: 2,
    clientName: 'Blue Spruce Landscaping',
    title: 'Catch-up call',
    startLabel: 'Aug 11, 2026',
    amount: null,
  },
]

describe('PendingBillableMeetings', () => {
  it('renders priced meetings with right-aligned tnum money', () => {
    render(<PendingBillableMeetings rows={rows} />)
    expect(screen.getAllByTestId('pending-meeting-row')).toHaveLength(2)
    expect(screen.getByText('$150.00')).toBeInTheDocument()
    expect(screen.getByText('August close review')).toBeInTheDocument()
    expect(screen.getByText('Aug 10, 2026')).toBeInTheDocument()
  })

  it('warns on meetings with no price set instead of a silent $0.00', () => {
    render(<PendingBillableMeetings rows={rows} />)
    const warnings = screen.getAllByTestId('no-price-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toHaveTextContent('No price set')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('renders the empty state when nothing is pending', () => {
    render(<PendingBillableMeetings rows={[]} />)
    expect(screen.getByText(/No billable meetings are waiting/)).toBeInTheDocument()
  })
})
