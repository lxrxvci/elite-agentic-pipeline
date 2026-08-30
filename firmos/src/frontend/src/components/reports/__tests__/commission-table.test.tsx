import { render, screen, within } from '@testing-library/react'
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
})
