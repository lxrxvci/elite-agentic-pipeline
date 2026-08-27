import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { getPayrollCsvAction } from '@/server/actions/time'
import type { PayrollCalculator } from '@/server/payroll'

import { PayrollTable } from '../payroll-table'

vi.mock('@/server/actions/time', () => ({
  getPayrollCsvAction: vi.fn(),
}))

const calc: PayrollCalculator = {
  year: 2026,
  month: 8,
  payoutConfig: { commission_payout: 'next_month_first' },
  rows: [
    {
      userId: 1,
      userName: 'Jorge Medina',
      role: 'bookkeeper',
      baseHourlyPay: 30,
      periods: [
        { key: 'first', start: '2026-08-01', end: '2026-08-15', payDate: '2026-08-20', hours: 60, hourlyPay: 1800 },
        { key: 'second', start: '2026-08-16', end: '2026-08-31', payDate: '2026-09-05', hours: 55, hourlyPay: 1650 },
      ],
      totalHours: 115,
      hourlyTotal: 3450,
      commission: {
        onTimePercent: 92.5,
        rate: 45,
        base: 4000,
        amount: 1800,
        payoutDate: '2026-09-20',
      },
      totalPay: 5250,
    },
    {
      userId: 2,
      userName: 'Dana Whitfield',
      role: 'manager',
      baseHourlyPay: 40,
      periods: [
        { key: 'first', start: '2026-08-01', end: '2026-08-15', payDate: '2026-08-20', hours: 40, hourlyPay: 1600 },
        { key: 'second', start: '2026-08-16', end: '2026-08-31', payDate: '2026-09-05', hours: 38.5, hourlyPay: 1540 },
      ],
      totalHours: 78.5,
      hourlyTotal: 3140,
      commission: null,
      totalPay: 3140,
    },
  ],
}

describe('PayrollTable', () => {
  it('renders one row per staff member with right-aligned tnum money', () => {
    render(<PayrollTable calc={calc} />)
    const rows = screen.getAllByTestId('payroll-row')
    expect(rows).toHaveLength(2)

    const jorge = rows[0]
    expect(within(jorge).getByText('Jorge Medina')).toBeInTheDocument()
    expect(within(jorge).getByText('115.00')).toHaveClass('tnum', 'text-right')
    expect(within(jorge).getByText('$3,450.00')).toBeInTheDocument()
    expect(within(jorge).getByText('$1,800.00')).toBeInTheDocument()
    expect(within(jorge).getByText('$5,250.00')).toBeInTheDocument()

    // Non-bookkeepers have no commission column value.
    const dana = rows[1]
    expect(within(dana).getByText('-')).toBeInTheDocument()
    // hourly pay and total pay are equal when there is no commission.
    expect(within(dana).getAllByText('$3,140.00')).toHaveLength(2)
  })

  it('renders the firm total row: hours, hourly, commission, total pay', () => {
    render(<PayrollTable calc={calc} />)
    const total = screen.getByTestId('payroll-total-row')
    expect(within(total).getByText('Firm total')).toBeInTheDocument()
    expect(within(total).getByText('193.50')).toBeInTheDocument() // 115 + 78.5
    expect(within(total).getByText('$6,590.00')).toBeInTheDocument() // 3450 + 3140
    expect(within(total).getByText('$1,800.00')).toBeInTheDocument() // commission sum
    expect(within(total).getByText('$8,390.00')).toBeInTheDocument() // 5250 + 3140
  })

  it('shows the commission payout date under the amount', () => {
    render(<PayrollTable calc={calc} />)
    expect(screen.getByText('pays Sep 20')).toBeInTheDocument()
  })

  it('expands a row to the semi-monthly period detail', async () => {
    render(<PayrollTable calc={calc} />)
    await userEvent.click(screen.getAllByTestId('payroll-row')[0])
    expect(screen.getByText(/1st - 15th/)).toBeInTheDocument()
    expect(screen.getByText(/16th - end/)).toBeInTheDocument()
    expect(screen.getByText(/45%/)).toBeInTheDocument()
  })

  it('exports the CSV through the server action', async () => {
    vi.mocked(getPayrollCsvAction).mockResolvedValue({ ok: true, data: 'user_id,user_name\n' })
    const url = { create: vi.fn(() => 'blob:mock'), revoke: vi.fn() }
    URL.createObjectURL = url.create
    URL.revokeObjectURL = url.revoke
    const click = vi.fn()
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') el.click = click
      return el
    })

    render(<PayrollTable calc={calc} />)
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(getPayrollCsvAction).toHaveBeenCalledWith(2026, 8)
    expect(click).toHaveBeenCalled()
  })
})
