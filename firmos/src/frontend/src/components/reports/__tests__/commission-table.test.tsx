import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CommissionRow } from '@/server/payroll'

import { CommissionTable } from '../commission-table'

function row(partial: Partial<CommissionRow> & Pick<CommissionRow, 'userId'>): CommissionRow {
  return {
    userName: `User ${partial.userId}`,
    onTimePercent: 92.5,
    rate: 45,
    usedOverride: false,
    commissionBase: 4000,
    commissionAmount: 1800,
    invoiceIds: [1, 2],
    ...partial,
  }
}

const rows: CommissionRow[] = [
  row({ userId: 1, userName: 'Jorge Medina', onTimePercent: 92.5, rate: 45 }),
  row({ userId: 2, userName: 'Priya Nair', onTimePercent: 86, rate: 40 }),
  row({ userId: 3, userName: 'Sam Ortega', onTimePercent: 92.5, rate: 50, usedOverride: true }),
  row({ userId: 4, userName: 'Lee Baker', onTimePercent: null, rate: 35 }),
]

function rowFor(name: string) {
  const row = screen
    .getAllByTestId('commission-row')
    .find((r) => within(r).queryByText(name) != null)!
  return within(row)
}

describe('CommissionTable on-time progress bar', () => {
  it('renders the bar with the % label and the next-rung caption', () => {
    render(<CommissionTable rows={rows} />)
    const jorge = rowFor('Jorge Medina')
    const bar = jorge.getByTestId('on-time-progress')
    expect(bar).toHaveTextContent('92.5%')
    expect(bar).toHaveTextContent('7.5 pts to 50%')
    const fill = jorge.getByTestId('on-time-progress-fill')
    expect(fill).toHaveStyle({ width: '25%' })
    expect(fill).toHaveClass('bg-status-on-track')
  })

  it('the fill color follows the tier badge mapping (never color alone)', () => {
    render(<CommissionTable rows={rows} />)
    const priya = rowFor('Priya Nair')
    expect(priya.getByTestId('on-time-progress')).toHaveTextContent('4 pts to 45%')
    expect(priya.getByTestId('on-time-progress-fill')).toHaveClass('bg-status-due-soon')
    expect(priya.getByRole('progressbar')).toHaveAttribute(
      'aria-label',
      'On-time 86.0%, 4 pts to 45%',
    )
  })

  it('override rows show the plain % with no band bar', () => {
    render(<CommissionTable rows={rows} />)
    const sam = rowFor('Sam Ortega')
    expect(sam.queryByTestId('on-time-progress')).not.toBeInTheDocument()
    expect(sam.getByText('92.5%')).toBeInTheDocument()
    expect(sam.getByText('Override 50%')).toBeInTheDocument()
  })

  it('the no-data case stays text only', () => {
    render(<CommissionTable rows={rows} />)
    const lee = rowFor('Lee Baker')
    expect(lee.queryByTestId('on-time-progress')).not.toBeInTheDocument()
    expect(lee.getByText('No data')).toBeInTheDocument()
  })

  it('columns sort asc/desc with aria-sort (D11), no-data on-time always last', async () => {
    const user = userEvent.setup()
    render(<CommissionTable rows={rows} />)

    const names = () =>
      screen.getAllByTestId('commission-row').map((r) => r.textContent ?? '')

    // Default: commission, descending.
    expect(names()[0]).toContain('Jorge Medina')

    // New column starts desc; repeat click flips to asc.
    await user.click(screen.getByTestId('sort-rate'))
    expect(screen.getByTestId('sort-rate').closest('th')).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(names()[0]).toContain('Sam Ortega') // rate 50
    await user.click(screen.getByTestId('sort-rate'))
    expect(screen.getByTestId('sort-rate').closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(names()[0]).toContain('Lee Baker') // rate 35

    // On-time: the null (no-data) row stays last in both directions.
    await user.click(screen.getByTestId('sort-onTime'))
    expect(names()[names().length - 1]).toContain('Lee Baker')
    await user.click(screen.getByTestId('sort-onTime'))
    expect(names()[names().length - 1]).toContain('Lee Baker')

    // Name starts asc on first click.
    await user.click(screen.getByTestId('sort-bookkeeper'))
    expect(screen.getByTestId('sort-bookkeeper').closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(names()[0]).toContain('Jorge Medina')
  })
})
