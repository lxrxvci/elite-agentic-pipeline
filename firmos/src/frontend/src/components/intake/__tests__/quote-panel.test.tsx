import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { QuotePanel, quoteLineNet } from '../quote-panel'

/**
 * C1 follow-through: the quote panel captures a per-line discount (flat $ off
 * per billing cycle) and shows the net amount; read-only mode is unchanged.
 */

const QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    {
      service_key: 'bank_feed_management',
      product_name: 'Bank Feed Management',
      unit_price: 100,
      quantity: 1,
      amount: 100,
      discount: 25,
      bucket: 'monthly',
      unpriced: false,
    },
    {
      service_key: 'process_payroll',
      product_name: 'Process Payroll',
      unit_price: null,
      quantity: 1,
      amount: null,
      bucket: 'payroll_monthly',
      unpriced: true,
    },
  ],
  totals: {
    totalMonthly: 75,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 0,
    effectiveMonthly: 75,
  },
}

describe('QuotePanel discounts (C1)', () => {
  it('quoteLineNet clamps the discount at zero', () => {
    expect(quoteLineNet(QUOTE.lines[0])).toBe(75)
    expect(quoteLineNet({ ...QUOTE.lines[0], discount: 250 })).toBe(0)
    expect(quoteLineNet({ ...QUOTE.lines[0], discount: 0 })).toBe(100)
    expect(quoteLineNet(QUOTE.lines[1])).toBeNull() // unpriced
  })

  it('editable mode renders a discount input per priced line and reports changes', () => {
    const onDiscountChange = vi.fn()
    render(
      <QuotePanel
        quote={QUOTE}
        loading={false}
        discounts={{ bank_feed_management: 25 }}
        onDiscountChange={onDiscountChange}
      />,
    )
    const input = screen.getByTestId('discount-bank_feed_management')
    expect(input).toHaveValue(25)
    // The discounted line shows gross struck through + the net.
    const row = input.closest('li')!
    expect(row).toHaveTextContent('$100')
    expect(row).toHaveTextContent('$75')
    // Unpriced lines never get an input.
    expect(screen.queryByTestId('discount-process_payroll')).toBeNull()

    fireEvent.change(input, { target: { value: '40' } })
    expect(onDiscountChange).toHaveBeenCalledWith('bank_feed_management', 40)
    // Clearing the input means no discount.
    fireEvent.change(input, { target: { value: '' } })
    expect(onDiscountChange).toHaveBeenCalledWith('bank_feed_management', 0)
  })

  it('read-only mode renders net amounts without inputs', () => {
    render(<QuotePanel quote={QUOTE} loading={false} />)
    expect(screen.queryByTestId('discount-bank_feed_management')).toBeNull()
    // The line nets the discount (the /mo headline matches too - scope to the line).
    const line = screen.getByText('Bank Feed Management').closest('li')!
    expect(line).toHaveTextContent('$75')
  })
})
