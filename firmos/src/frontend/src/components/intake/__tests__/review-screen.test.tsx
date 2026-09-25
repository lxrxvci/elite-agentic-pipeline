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

// The quote section's "Email proposal" button (correspondence hub).
const sendIntakeQuoteEmailAction = vi.fn(async (_id: unknown) => ({
  ok: true as const,
  data: { correspondenceId: 5, to: 'wren@fernfeather.shop' },
}))
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: (id: unknown) => sendIntakeQuoteEmailAction(id),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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

  it('offers Email proposal to manager+ and sends through the action', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    sendIntakeQuoteEmailAction.mockClear()
    render(
      <ReviewScreen
        intakeId={7}
        answers={ANSWERS}
        quote={QUOTE}
        status="pending_review"
        canConvert
        managers={[]}
        bookkeepers={[]}
        clientId={null}
        onEdit={() => {}}
      />,
    )
    await user.click(screen.getByTestId('email-proposal'))
    expect(sendIntakeQuoteEmailAction).toHaveBeenCalledWith(7)
  })

  it('hides Email proposal from read-only reviewers', () => {
    renderReview()
    expect(screen.queryByTestId('email-proposal')).not.toBeInTheDocument()
  })
})

describe('ReviewScreen I1 answer rendering', () => {
  it('shows custom Other text verbatim, the CPA card, the referral who, and no catch-up row', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Custom Co',
          engagementType: 'bookkeeping',
          contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
          taxStructure: 'Other',
          customAnswers: { 'tax-structure': 'Series LLC taxed as a trust' },
          hasCpa: true,
          cpaName: 'Cascade Tax Group',
          referralSource: 'CPA referral',
          referralWho: 'Carlos at Cascade',
          bookkeepingStartDate: '2026-01-05',
        }}
        quote={null}
        status="draft"
        canConvert={false}
        managers={[]}
        bookkeepers={[]}
        clientId={null}
        onEdit={() => {}}
      />,
    )
    // The typed custom text renders verbatim, never the bare "Other".
    expect(screen.getByText('Series LLC taxed as a trust')).toBeInTheDocument()
    // The CPA card folds name into the yes/no row.
    expect(screen.getByText('Yes · Cascade Tax Group')).toBeInTheDocument()
    // Referral folds in who to thank.
    expect(screen.getByText('CPA referral · Carlos at Cascade')).toBeInTheDocument()
    // The text-entry date renders as a real date label…
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument()
    // …and the removed catch-up screen has no row anywhere.
    expect(screen.queryByText(/catch-up date/i)).toBeNull()
  })
})
