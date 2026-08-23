import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WorkstationView } from './workstation'

describe('WorkstationView', () => {
  it('renders the stat strip, filter chips, and color-coded queue', () => {
    render(<WorkstationView />)
    // "Overdue" intentionally appears as stat, chip, AND badge — color-coded language everywhere
    expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('tablist', { name: 'Filter work items' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Work queue' })).toBeInTheDocument()
    // Accounting-month chips render on rows
    expect(screen.getAllByText('Aug 2026').length).toBeGreaterThan(0)
    // Client health portfolio renders with rings
    expect(screen.getByRole('region', { name: 'Client health' })).toBeInTheDocument()
    expect(screen.getByText('Harrington Legal Group')).toBeInTheDocument()
  })

  it('narrows the queue when a filter chip is selected', async () => {
    render(<WorkstationView />)
    await userEvent.click(screen.getByRole('tab', { name: /Overdue/ }))
    const queue = screen.getByRole('region', { name: 'Work queue' })
    // Both overdue rows visible, no on_track rows
    expect(queue.textContent).toContain('Weekly bank feed — Operating')
    expect(queue.textContent).not.toContain('August reconciliation — Amex Business')
  })

  it('removes a work item from the queue when completed (≤2 interactions)', async () => {
    render(<WorkstationView />)
    await userEvent.click(
      screen.getByRole('button', { name: /Complete: July reconciliation/ }),
    )
    const queue = screen.getByRole('region', { name: 'Work queue' })
    expect(queue.textContent).not.toContain('July reconciliation')
  })

  it('supports keyboard-first flow: j/k to move, E to complete', async () => {
    render(<WorkstationView />)
    const surface = screen.getByRole('main').parentElement as HTMLElement
    surface.focus()
    await userEvent.keyboard('jje')
    const queue = screen.getByRole('region', { name: 'Work queue' })
    // Third row (index 2) is Bluebird Coffee weekly feed (due_soon)
    expect(queue.textContent).not.toContain('Weekly bank feed — Payroll')
  })
})

