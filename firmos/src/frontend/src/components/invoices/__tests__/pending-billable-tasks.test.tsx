import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PendingBillableTasks } from '../pending-billable-tasks'
import type { PendingTaskRow } from '../view-model'

const rows: PendingTaskRow[] = [
  {
    taskId: 501,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: 'Catch-up: categorize backlog of owner expenses',
    completedLabel: 'Aug 20, 2026',
    unitPrice: '150.00',
  },
  {
    taskId: 502,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: 'Reconstruct missing April deposit detail',
    completedLabel: 'Aug 21, 2026',
    unitPrice: null,
  },
]

describe('PendingBillableTasks', () => {
  it('renders priced tasks with right-aligned tnum money', () => {
    render(<PendingBillableTasks rows={rows} />)
    expect(screen.getAllByTestId('pending-task-row')).toHaveLength(2)
    expect(screen.getByText('$150.00')).toBeInTheDocument()
    expect(screen.getByText('Catch-up: categorize backlog of owner expenses')).toBeInTheDocument()
    expect(screen.getByText('Aug 20, 2026')).toBeInTheDocument()
  })

  it('warns on tasks with no price set instead of a silent $0.00', () => {
    render(<PendingBillableTasks rows={rows} />)
    const warnings = screen.getAllByTestId('no-price-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toHaveTextContent('No price set')
    // The unpriced row must not render a $0.00 amount.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('renders the caught-up empty state when nothing is pending', () => {
    render(<PendingBillableTasks rows={[]} />)
    expect(screen.getByText(/Nothing billable is waiting/)).toBeInTheDocument()
  })
})
