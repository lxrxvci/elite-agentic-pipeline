import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setPricingOverrideAction } from '@/server/actions/pricing'
import type { EffectivePricingRow } from '@/server/pricing-config'

import { PricingTable } from '../pricing-table'

vi.mock('@/server/actions/pricing', () => ({
  setPricingOverrideAction: vi.fn(),
  setCommissionTiersAction: vi.fn(),
}))

const mockSet = vi.mocked(setPricingOverrideAction)

function row(
  serviceKey: string,
  productName: string,
  unitPrice: number | null,
  group: EffectivePricingRow['entry']['group'] = 'core_monthly',
  override: number | null = null,
): EffectivePricingRow {
  return {
    serviceKey,
    entry: {
      product_name: productName,
      group,
      unit_price: unitPrice,
      unit: 'month',
      scaling: 'flat_monthly',
      bucket: 'monthly',
    },
    override,
    effectivePrice: override ?? unitPrice,
  }
}

const ROWS: EffectivePricingRow[] = [
  row('bank_feed_management', 'Bank Feed Management', 100),
  row('monthly_reporting_15', 'Monthly Reporting (close by the 15th)', 25, 'reporting'),
  row('process_payroll', 'Process Payroll', null, 'payroll'),
  row('quickbooks_plus', 'QuickBooks Plus (pass-through)', 90, 'other', 99),
]

beforeEach(() => {
  vi.clearAllMocks()
  mockSet.mockImplementation(async (key, price) => ({
    ok: true as const,
    data: { overrides: price == null ? {} : { [key]: price } },
  }))
})

describe('PricingTable', () => {
  it('renders groups with default and effective prices, muted defaults', () => {
    render(<PricingTable rows={ROWS} />)
    expect(screen.getByText('Core monthly')).toBeInTheDocument()
    expect(screen.getByText('Reporting')).toBeInTheDocument()
    expect(screen.getByText('Bank Feed Management')).toBeInTheDocument()
    // Default and effective columns both render the price for a clean row.
    expect(screen.getAllByText('$100').length).toBe(2)
    // Unpriced services say so in both default and effective columns.
    expect(screen.getAllByText('Unpriced').length).toBe(2)
  })

  it('an overridden row shows the Custom chip (dot + label, never color alone) and the effective price', () => {
    render(<PricingTable rows={ROWS} />)
    const chip = screen.getByText('Custom')
    expect(chip.closest('[data-status]')).toHaveAttribute('data-status', 'due_soon')
    const tableRow = chip.closest('tr')!
    expect(tableRow).toHaveAttribute('data-service-key', 'quickbooks_plus')
    expect(tableRow.textContent).toContain('$99')
  })

  it('committing an override input calls the action with the new price', async () => {
    render(<PricingTable rows={ROWS} />)
    const input = screen.getByLabelText('Override price for Bank Feed Management')
    await userEvent.type(input, '120')
    await userEvent.tab() // blur commits
    expect(mockSet).toHaveBeenCalledWith('bank_feed_management', 120)
  })

  it('clearing an overridden input resets to the default', async () => {
    render(<PricingTable rows={ROWS} />)
    const input = screen.getByLabelText('Override price for QuickBooks Plus (pass-through)')
    expect(input).toHaveValue('99')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(mockSet).toHaveBeenCalledWith('quickbooks_plus', null)
  })

  it('the reset button clears the override without editing the input', async () => {
    render(<PricingTable rows={ROWS} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Reset QuickBooks Plus (pass-through) to the default price' }),
    )
    expect(mockSet).toHaveBeenCalledWith('quickbooks_plus', null)
  })

  it('rejects a negative price client-side without calling the action', async () => {
    render(<PricingTable rows={ROWS} />)
    const input = screen.getByLabelText('Override price for Bank Feed Management')
    await userEvent.type(input, '-5')
    await userEvent.tab()
    expect(mockSet).not.toHaveBeenCalled()
    // The draft reverts to the baseline (empty: no override was set).
    expect(input).toHaveValue('')
  })

  it('prices an unpriced service once an override is committed', async () => {
    mockSet.mockResolvedValue({
      ok: true as const,
      data: { overrides: { process_payroll: 40 } },
    })
    render(<PricingTable rows={ROWS} />)
    const input = screen.getByLabelText('Override price for Process Payroll')
    await userEvent.type(input, '40')
    await userEvent.tab()
    expect(mockSet).toHaveBeenCalledWith('process_payroll', 40)
    const tableRow = input.closest('tr')!
    expect(tableRow.textContent).toContain('$40')
    expect(tableRow.textContent).toContain('Custom')
  })
})
