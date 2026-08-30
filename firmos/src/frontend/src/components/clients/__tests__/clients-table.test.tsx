import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { ClientsTable } from '../clients-table'
import { seedListRows } from './fixtures'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

function renderTable(rows = seedListRows) {
  return render(
    <TooltipProvider>
      <ClientsTable rows={rows} />
    </TooltipProvider>,
  )
}

describe('ClientsTable', () => {
  it('renders the seeded shape: one dense row per client', () => {
    renderTable()
    const rows = screen.getAllByTestId('client-row')
    expect(rows).toHaveLength(6)
    expect(screen.getByText('Harborline Marine Supply')).toBeInTheDocument()
    expect(screen.getByText('Blue Spruce Landscaping')).toBeInTheDocument()
    expect(screen.getByText('Copperline Coffee Roasters')).toBeInTheDocument()
    expect(screen.getByText('Redwood Pediatric Therapy')).toBeInTheDocument()
    expect(screen.getByText('Summit Peak Builders')).toBeInTheDocument()
  })

  it('renders DBA as the primary name with the legal name muted below', () => {
    renderTable()
    const northwind = screen
      .getAllByTestId('client-row')
      .find((r) => r.getAttribute('data-client-id') === '4')!
    expect(within(northwind).getByText('Northwind')).toBeInTheDocument()
    expect(within(northwind).getByText('Northwind Frame & Door')).toBeInTheDocument()
  })

  it('maps lifecycle states to the status-token chips (dot + label)', () => {
    renderTable()
    const row = (id: string) =>
      screen.getAllByTestId('client-row').find((r) => r.getAttribute('data-client-id') === id)!

    const active = within(row('1')).getByText('Active')
    expect(active.closest('[data-status]')).toHaveAttribute('data-status', 'on_track')

    const paused = within(row('5')).getByText('Paused')
    expect(paused.closest('[data-status]')).toHaveAttribute('data-status', 'on_hold')

    const project = within(row('6')).getByText('Project')
    expect(project.closest('[data-status]')).toHaveAttribute('data-status', 'deferred')
  })

  it('shows cadence with close tier, and a Not scored marker for on-hold clients', () => {
    renderTable()
    expect(screen.getByText('Monthly · Close 5th')).toBeInTheDocument()
    expect(screen.getAllByText('Monthly · Close 15th')).toHaveLength(2)
    expect(screen.getByText('Monthly · Close 10th')).toBeInTheDocument()
    expect(screen.getByText('Quarterly')).toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
  })

  it('filters by search text across legal name and DBA', async () => {
    const user = userEvent.setup()
    renderTable()
    await user.type(screen.getByLabelText('Search clients'), 'spruce')
    expect(screen.getAllByTestId('client-row')).toHaveLength(1)
    expect(screen.getByText('Blue Spruce Landscaping')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search clients'))
    await user.type(screen.getByLabelText('Search clients'), 'zzz')
    expect(screen.queryAllByTestId('client-row')).toHaveLength(0)
    expect(screen.getByText('No clients match these filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByTestId('client-row')).toHaveLength(6)
  })

  it('sorts by open work count, descending first, toggling direction', async () => {
    const user = userEvent.setup()
    renderTable()
    const order = () =>
      screen.getAllByTestId('client-row').map((r) => r.getAttribute('data-client-id'))

    await user.click(screen.getByRole('button', { name: /Open work/ }))
    expect(order()[0]).toBe('1') // 14 open
    expect(order()[1]).toBe('2') // 9 open

    await user.click(screen.getByRole('button', { name: /Open work/ }))
    expect(order()[0]).toBe('4') // 0 open (name tiebreak: Northwind)
  })

  it('sorts by health score with unscored clients pinned last', async () => {
    const user = userEvent.setup()
    renderTable()
    await user.click(screen.getByRole('button', { name: /Health/ }))
    const order = screen.getAllByTestId('client-row').map((r) => r.getAttribute('data-client-id'))
    // 100 scorers first (name tiebreak), 60 before 92, paused client last.
    expect(order[order.length - 1]).toBe('5')
    expect(order.indexOf('2')).toBeGreaterThan(order.indexOf('3'))
  })

  it('navigates to the client record on row click and on Enter', async () => {
    push.mockClear()
    const user = userEvent.setup()
    renderTable()
    await user.click(screen.getByText('Harborline Marine Supply'))
    expect(push).toHaveBeenCalledWith('/clients/1')

    const row = screen.getAllByTestId('client-row')[1]
    row.focus()
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenCalledWith(`/clients/${row.getAttribute('data-client-id')}`)
  })

  it('renders the empty state when there are no clients at all', () => {
    renderTable([])
    expect(screen.getByText('No clients yet')).toBeInTheDocument()
  })

  it('hides the Eff. $/hr column by default (billing content is admin/owner only)', () => {
    const rows = seedListRows.map((r) => ({ ...r, effectiveHourlyRate: 42.5 }))
    renderTable(rows)
    expect(screen.queryByText('Eff. $/hr')).not.toBeInTheDocument()
    expect(screen.queryByText('$42.50')).not.toBeInTheDocument()
  })

  it('shows the Eff. $/hr column for admin/owner, dash when a client has no hours', () => {
    const rows = seedListRows.map((r, i) => ({
      ...r,
      effectiveHourlyRate: i === 0 ? 42.5 : null,
    }))
    render(
      <TooltipProvider>
        <ClientsTable rows={rows} canSeeRates />
      </TooltipProvider>,
    )
    expect(screen.getByText('Eff. $/hr')).toBeInTheDocument()
    expect(screen.getByText('$42.50')).toBeInTheDocument()
    expect(screen.getAllByText('-')).toHaveLength(5)
  })
})

describe('ClientsTable close streaks', () => {
  it('shows the streak pill only on rows with 3+ closed periods in a row', () => {
    renderTable()
    const badges = screen.getAllByTestId('streak-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('3 in a row')
    // The pill sits on the streaking client's row.
    const harborline = screen
      .getAllByTestId('client-row')
      .find((r) => r.getAttribute('data-client-id') === '1')!
    expect(within(harborline).getByTestId('streak-badge')).toBeInTheDocument()
  })

  it('renders no pill below the 3-period threshold', () => {
    renderTable(seedListRows.map((r) => ({ ...r, closeStreak: 2 })))
    expect(screen.queryByTestId('streak-badge')).not.toBeInTheDocument()
  })
})
