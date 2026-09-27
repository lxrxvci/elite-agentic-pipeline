import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { QuoteHiddenCard, QuotePanel, quoteLineNet } from '../quote-panel'

/**
 * J4 (V4, meeting #3 01:01:22-01:02:14): the quote panel captures DIRECT
 * PRICE edits (dollars per billing cycle) instead of the old discount boxes.
 * Legacy stored discounts still net their lines (standard struck through)
 * until the price is edited or reset. Read-only mode is unchanged.
 * I4: QuoteHiddenCard is the collapsed rail (staff peek toggle, no amounts);
 * the review reveal plays a one-time entrance.
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

describe('QuotePanel direct price editing (V4)', () => {
  it('quoteLineNet: the override wins, the legacy discount nets, both clamp at zero', () => {
    expect(quoteLineNet(QUOTE.lines[0])).toBe(75) // 100 - 25 legacy discount
    expect(quoteLineNet({ ...QUOTE.lines[0], discount: 250 })).toBe(0)
    expect(quoteLineNet({ ...QUOTE.lines[0], discount: 0 })).toBe(100)
    expect(quoteLineNet({ ...QUOTE.lines[0], price_override: 60 })).toBe(60) // beats the discount
    expect(quoteLineNet(QUOTE.lines[1])).toBeNull() // unpriced
    // ...but an override prices even an unpriced line.
    expect(quoteLineNet({ ...QUOTE.lines[1], price_override: 200 })).toBe(200)
  })

  it('editable mode renders a price editor per line and reports saves and resets', () => {
    const onPriceChange = vi.fn()
    render(<QuotePanel quote={QUOTE} loading={false} onPriceChange={onPriceChange} />)

    // The legacy-discounted line shows the standard struck through + the net,
    // with NO discount input and no negative numbers anywhere.
    const row = screen.getByText('Bank Feed Management').closest('li')!
    expect(row).toHaveTextContent('$100')
    expect(row).toHaveTextContent('$75')
    expect(screen.queryByTestId('discount-bank_feed_management')).toBeNull()
    expect(row.textContent).not.toMatch(/−\$|-\$/)

    // Open the editor: the effective price prefills.
    fireEvent.click(screen.getByTestId('price-edit-bank_feed_management'))
    const input = screen.getByTestId('price-input-bank_feed_management')
    expect(input).toHaveValue(75)
    fireEvent.change(input, { target: { value: '80' } })
    fireEvent.click(screen.getByTestId('price-save-bank_feed_management'))
    expect(onPriceChange).toHaveBeenCalledWith('bank_feed_management', 80)

    // Saving the standard price writes a reset (no pointless override).
    fireEvent.click(screen.getByTestId('price-edit-bank_feed_management'))
    fireEvent.change(screen.getByTestId('price-input-bank_feed_management'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('price-save-bank_feed_management'))
    expect(onPriceChange).toHaveBeenCalledWith('bank_feed_management', null)

    // The reset affordance (deviating line) clears override + legacy discount.
    fireEvent.click(screen.getByTestId('price-reset-bank_feed_management'))
    expect(onPriceChange).toHaveBeenCalledWith('bank_feed_management', null)
    expect(onPriceChange).toHaveBeenCalledTimes(3)
  })

  it('an unpriced line gets an editor too - the price is set at review', () => {
    const onPriceChange = vi.fn()
    render(<QuotePanel quote={QUOTE} loading={false} onPriceChange={onPriceChange} />)
    const row = screen.getByText('Process Payroll').closest('li')!
    expect(row).toHaveTextContent('quoted at review')
    fireEvent.click(screen.getByTestId('price-edit-process_payroll'))
    fireEvent.change(screen.getByTestId('price-input-process_payroll'), { target: { value: '200' } })
    fireEvent.click(screen.getByTestId('price-save-process_payroll'))
    expect(onPriceChange).toHaveBeenCalledWith('process_payroll', 200)
  })

  it('read-only mode renders net amounts without editors', () => {
    render(<QuotePanel quote={QUOTE} loading={false} />)
    expect(screen.queryByTestId('price-edit-bank_feed_management')).toBeNull()
    const line = screen.getByText('Bank Feed Management').closest('li')!
    expect(line).toHaveTextContent('$75')
  })
})

describe('QuoteHiddenCard + reveal (I4, plan §3D)', () => {
  it('the collapsed rail shows no amounts, just the peek toggle', () => {
    const onShow = vi.fn()
    render(<QuoteHiddenCard onShow={onShow} />)
    const card = screen.getByTestId('quote-hidden')
    expect(card).toHaveTextContent('Pricing')
    expect(card).not.toHaveTextContent('$')
    const toggle = screen.getByTestId('quote-peek-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveTextContent('Show pricing')
    fireEvent.click(toggle)
    expect(onShow).toHaveBeenCalled()
    // No quote content renders while hidden.
    expect(screen.queryByTestId('quote-amount')).toBeNull()
  })

  it('the peeked panel carries the discreet hide control', () => {
    const onHide = vi.fn()
    render(
      <QuotePanel quote={QUOTE} loading={false} onPriceChange={() => {}} onHidePricing={onHide} />,
    )
    const toggle = screen.getByTestId('quote-hide-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(onHide).toHaveBeenCalled()
  })

  it('the review reveal marks the panel and plays the entrance class', () => {
    const revealed = render(<QuotePanel quote={QUOTE} loading={false} reveal />)
    const panel = revealed.getByTestId('live-quote')
    expect(panel).toHaveAttribute('data-revealed', 'true')
    expect(panel.className).toContain('fi-quote-reveal')
    // Without the flag there is no reveal marker.
    const plain = render(<QuotePanel quote={QUOTE} loading={false} />)
    expect(plain.container.querySelector('[data-testid="live-quote"]')).not.toHaveAttribute(
      'data-revealed',
    )
  })
})
