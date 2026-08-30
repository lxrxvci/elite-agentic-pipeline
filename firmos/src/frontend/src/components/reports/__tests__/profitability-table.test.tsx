import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ClientProfitability } from '@/server/profitability'

import { ProfitabilityTable, marginBarPercent } from '../profitability-table'

const rows: ClientProfitability[] = [
  {
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    recurringMonthly: 100,
    hoursWorked: 10,
    effectiveHourlyRate: 10,
    laborCostEstimate: 150,
    margin: -50,
  },
  {
    clientId: 2,
    clientName: 'Blue Spruce Landscaping',
    recurringMonthly: 400,
    hoursWorked: 8,
    effectiveHourlyRate: 50,
    laborCostEstimate: 320,
    margin: 20,
  },
  {
    clientId: 3,
    clientName: 'Copperline Coffee Roasters',
    recurringMonthly: 500,
    hoursWorked: 5,
    effectiveHourlyRate: 100,
    laborCostEstimate: 125,
    margin: 75,
  },
  {
    clientId: 4,
    clientName: 'Northwind Frame & Door',
    recurringMonthly: null,
    hoursWorked: 3,
    effectiveHourlyRate: null,
    laborCostEstimate: 75,
    margin: null,
  },
  {
    clientId: 5,
    clientName: 'Summit Peak Builders',
    recurringMonthly: 250,
    hoursWorked: 0,
    effectiveHourlyRate: null,
    laborCostEstimate: null,
    margin: null,
  },
]

function rowFor(name: string) {
  const row = screen
    .getAllByTestId('profitability-row')
    .find((r) => within(r).queryByText(name) != null)!
  return within(row)
}

describe('ProfitabilityTable', () => {
  it('renders recurring, hours, effective rate, and labor per client', () => {
    render(<ProfitabilityTable rows={rows} />)
    expect(screen.getAllByTestId('profitability-row')).toHaveLength(5)

    const harborline = rowFor('Harborline Marine Supply')
    expect(harborline.getByText('$100.00')).toBeInTheDocument()
    expect(harborline.getByText('10.00')).toBeInTheDocument()
    expect(harborline.getByText('$10.00/hr')).toBeInTheDocument()
    expect(harborline.getByText('$150.00')).toBeInTheDocument()
  })

  it('maps margin to the status tokens with the number always visible', () => {
    render(<ProfitabilityTable rows={rows} />)

    const negative = rowFor('Harborline Marine Supply')
    expect(negative.getByText('-50.0%')).toBeInTheDocument()
    expect(negative.getByText('Negative').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'overdue',
    )

    const thin = rowFor('Blue Spruce Landscaping')
    expect(thin.getByText('20.0%')).toBeInTheDocument()
    expect(thin.getByText('Thin').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'due_soon',
    )

    const healthy = rowFor('Copperline Coffee Roasters')
    expect(healthy.getByText('75.0%')).toBeInTheDocument()
    expect(healthy.getByText('Healthy').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'on_track',
    )
  })

  it('dashes out missing recurring, rate, labor, and margin instead of guessing', () => {
    render(<ProfitabilityTable rows={rows} />)
    // Northwind: no recurring, no rate, no margin (labor shown) = 3 dashes.
    expect(rowFor('Northwind Frame & Door').getAllByText('-')).toHaveLength(3)
    // Summit: no hours - rate, labor, and margin all null = 3 dashes.
    expect(rowFor('Summit Peak Builders').getAllByText('-')).toHaveLength(3)
  })

  it('renders the empty state when there are no active clients', () => {
    render(<ProfitabilityTable rows={[]} />)
    expect(screen.getByText('No active clients')).toBeInTheDocument()
  })
})

describe('marginBarPercent', () => {
  it('passes in-range margins through', () => {
    expect(marginBarPercent(20)).toBe(20)
    expect(marginBarPercent(75)).toBe(75)
  })

  it('clamps negative margins to an empty track and outliers to a full one', () => {
    expect(marginBarPercent(-50)).toBe(0)
    expect(marginBarPercent(0)).toBe(0)
    expect(marginBarPercent(100)).toBe(100)
    expect(marginBarPercent(240)).toBe(100)
  })
})

describe('ProfitabilityTable margin bar', () => {
  it('fills the inline bar to the margin with the status color', () => {
    render(<ProfitabilityTable rows={rows} />)
    const healthy = rowFor('Copperline Coffee Roasters')
    const fill = healthy.getByTestId('margin-bar-fill')
    expect(fill).toHaveStyle({ width: '75%' })
    expect(fill).toHaveClass('bg-status-on-track')

    const thin = rowFor('Blue Spruce Landscaping')
    expect(thin.getByTestId('margin-bar-fill')).toHaveStyle({ width: '20%' })
    expect(thin.getByTestId('margin-bar-fill')).toHaveClass('bg-status-due-soon')
  })

  it('a negative margin shows an empty track next to the danger figure', () => {
    render(<ProfitabilityTable rows={rows} />)
    const negative = rowFor('Harborline Marine Supply')
    expect(negative.getByTestId('margin-bar-fill')).toHaveStyle({ width: '0%' })
    expect(negative.getByText('-50.0%')).toHaveClass('text-money-negative')
  })

  it('no bar renders when the margin is null', () => {
    render(<ProfitabilityTable rows={rows} />)
    expect(rowFor('Northwind Frame & Door').queryByTestId('margin-bar')).not.toBeInTheDocument()
  })
})
