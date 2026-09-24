import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { ReviewScreen } from '../review-screen'
import type { WizardAnswers } from '../registry'

/**
 * Review-screen quote section: per-line discounts render as a "-$x/cycle"
 * chip with the gross struck through and the net bold (C1 follow-through).
 * Server actions are mocked; the registry supplies the chapters.
 */

vi.mock('@/server/actions/intake', () => ({
  checkDuplicates: vi.fn(async () => ({ ok: true, data: [] })),
  submitIntakeForReview: vi.fn(async () => ({ ok: true, data: {} })),
}))

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
      service_key: 'specialty_report_1_retro',
      product_name: 'Missed past filings: Oregon Special Report',
      unit_price: 200,
      quantity: 18,
      amount: 3600,
      bucket: 'one_time',
      unpriced: false,
    },
  ],
  totals: {
    totalMonthly: 75,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 3600,
    effectiveMonthly: 75,
  },
}

const ANSWERS: WizardAnswers = {
  legalName: 'Discount Review Co',
  engagementType: 'bookkeeping',
}

function renderReview(quote: Quote | null = QUOTE) {
  return render(
    <ReviewScreen
      intakeId={1}
      answers={ANSWERS}
      quote={quote}
      status="draft"
      canConvert={false}
      managers={[]}
      bookkeepers={[]}
      clientId={null}
      onEdit={() => {}}
    />,
  )
}

describe('ReviewScreen quote discounts (C1)', () => {
  it('shows the per-line discount chip and the net amount', () => {
    renderReview()
    const quote = screen.getByTestId('review-quote')
    const chip = screen.getByTestId('review-discount-bank_feed_management')
    expect(chip).toHaveTextContent('−$25/cycle')
    const row = chip.closest('li')!
    // Gross struck through, net rendered.
    expect(row).toHaveTextContent('$100')
    expect(row).toHaveTextContent('$75')
    // The effective monthly header is the discounted rate.
    expect(quote).toHaveTextContent('$75')
    // C10 retro line: full one-time amount, no discount chip.
    expect(quote).toHaveTextContent('Missed past filings: Oregon Special Report')
    expect(quote).toHaveTextContent('$3,600')
  })

  it('renders plain amounts when no line is discounted', () => {
    renderReview({ ...QUOTE, lines: QUOTE.lines.map((l) => ({ ...l, discount: 0 })) })
    expect(screen.queryByTestId('review-discount-bank_feed_management')).toBeNull()
    expect(screen.getByTestId('review-quote')).toHaveTextContent('Bank Feed Management')
  })
})
