import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'
import { ReviewScreen } from '../review-screen'
import { buildBillingProjection, type OneTimeItem } from '../review-estimate'

/**
 * M7 (10_10, meeting #5 coverage pass): the three items the M1-M6 waves
 * missed from the raw transcript -
 *  00:20:21: the tier-hours inputs render as ONE Difficulty row.
 *  01:12:43: every line carries the "normal invoice vs its own invoice" pick.
 *  00:53:32: the retro cleanup bills at a picked frequency in installments.
 */

vi.mock('@/server/actions/intake', () => ({
  checkDuplicates: vi.fn(async () => ({ ok: true, data: [] })),
  submitIntakeForReview: vi.fn(async () => ({ ok: true, data: {} })),
  acceptIntakeEstimate: vi.fn(async () => ({ ok: true, data: { status: 'accepted' } })),
}))
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true as const, data: { correspondenceId: 5, to: 'wren@example.com' } })),
  previewIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true as const, data: { to: 'wren@example.com', subject: 's', body: 'b' } })),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const MONTHLY_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
  ],
  totals: {
    totalMonthly: 100,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 0,
    effectiveMonthly: 100,
  },
}

const RETRO_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
    { service_key: 'retroactive_bookkeeping', product_name: 'Retroactive Bookkeeping', unit_price: 200, quantity: 6, amount: 1200, bucket: 'one_time', unpriced: false },
  ],
  totals: {
    totalMonthly: 100,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 1200,
    effectiveMonthly: 100,
  },
  retroactive: {
    months: 6,
    startMonth: { year: 2025, month: 7 },
    perMonthRate: 200,
    baseTotal: 1200,
    total: 1200,
    discountPercent: null,
  },
}

function renderReview(answers: WizardAnswers, quote: Quote, extra: Record<string, unknown> = {}) {
  return render(
    <ReviewScreen
      intakeId={1}
      answers={answers}
      quote={quote}
      status="draft"
      canConvert={false}
      managers={[]}
      bookkeepers={[]}
      clientId={null}
      onEdit={() => {}}
      onPriceChange={() => {}}
      {...extra}
    />,
  )
}

describe('M7: difficulty_row_groups_tier_hours (10_10 00:20:21)', () => {
  it('the three tier-hour inputs render under one Difficulty header row', () => {
    render(
      <QuestionScreen
        q={findQuestion('reporting', 'reports')!}
        answers={{ engagementType: 'bookkeeping' } as WizardAnswers}
        onApply={() => {}}
        onAdvance={() => {}}
        onPickOption={() => {}}
      />,
    )
    // Pick "Estimated hours" on the draft's pricing-mode select.
    fireEvent.change(screen.getByLabelText('How should it be priced?'), { target: { value: 'hours' } })
    const row = screen.getByTestId('row-group-difficulty')
    expect(within(row).getByText('Difficulty')).toBeInTheDocument()
    expect(within(row).getByLabelText('Bookkeeper hours')).toBeInTheDocument()
    expect(within(row).getByLabelText('Manager hours')).toBeInTheDocument()
    expect(within(row).getByLabelText('Owner hours')).toBeInTheDocument()
    // Flat pricing hides the whole row, field and header alike.
    fireEvent.change(screen.getByLabelText('How should it be priced?'), { target: { value: 'flat' } })
    expect(screen.queryByTestId('row-group-difficulty')).toBeNull()
  })
})

describe('M7: own_invoice_selector_on_every_line (10_10 01:12:43)', () => {
  const answers = { legalName: 'Route Co', engagementType: 'bookkeeping' } as WizardAnswers

  it('the routing select writes ownInvoice through the line-billing writer', () => {
    const onLineBilling = vi.fn()
    renderReview(answers, MONTHLY_QUOTE, { onLineBilling })
    const select = screen.getByTestId('own-invoice-bank_feed_management')
    expect(select).toHaveValue('normal')
    fireEvent.change(select, { target: { value: 'own' } })
    expect(onLineBilling).toHaveBeenCalledWith('bank_feed_management', { ownInvoice: true })
  })

  it('a routed line separates on the 12-month projection', () => {
    const routed = {
      ...answers,
      lineBilling: { bank_feed_management: { ownInvoice: true } },
    } as WizardAnswers
    renderReview(routed, MONTHLY_QUOTE, { onLineBilling: () => {} })
    const select = screen.getByTestId('own-invoice-bank_feed_management')
    expect(select).toHaveValue('own')
    // The projection's first month carries the own-invoice total note.
    const months = screen.getAllByTestId(/^projection-\d{4}-\d{2}$/)
    const first = months[0]
    expect(within(first).getByText(/own invoice/)).toBeInTheDocument()
  })
})

describe('M7: retro_cleanup_bills_at_frequency (10_10 00:53:32)', () => {
  const answers = { legalName: 'Retro Co', engagementType: 'bookkeeping' } as WizardAnswers
  const retroItem: OneTimeItem = {
    key: 'retroactive_bookkeeping_2025',
    name: '2025 cleanup',
    amount: 1200,
    standard: 1200,
    overridden: false,
    unpriced: false,
    math: '6 months × $200/mo',
    periods: null,
  }
  const anchor = { year: 2026, month: 1 }

  it('no frequency picked: the retro block lands whole on the first month (legacy)', () => {
    const projection = buildBillingProjection([], [], [retroItem], answers, anchor, 12, { months: 6, perMonth: 200 })
    expect(projection[0].lines.some((l) => l.key === 'retroactive_bookkeeping_2025' && l.amount === 1200)).toBe(true)
    expect(projection[1].lines.filter((l) => l.key.startsWith('retroactive')).length).toBe(0)
  })

  it('quarterly: 3 cleanup months per installment, every 3rd month', () => {
    const withFreq = { ...answers, retroBillingFrequency: 'quarterly' as const }
    const projection = buildBillingProjection([], [], [retroItem], withFreq, anchor, 12, { months: 6, perMonth: 200 })
    const installmentAt = (i: number) =>
      projection[i].lines.find((l) => l.key === 'retroactive_bookkeeping')
    expect(installmentAt(0)).toMatchObject({ amount: 600, note: 'installment 1' })
    expect(installmentAt(1)).toBeUndefined()
    expect(installmentAt(2)).toBeUndefined()
    expect(installmentAt(3)).toMatchObject({ amount: 600, note: 'installment 2' })
    // 6 cleanup months covered in 2 installments - nothing after.
    expect(installmentAt(6)).toBeUndefined()
  })

  it('monthly: one cleanup month per invoice until covered; the remainder shortens the last one', () => {
    const withFreq = { ...answers, retroBillingFrequency: 'monthly' as const }
    const projection = buildBillingProjection([], [], [retroItem], withFreq, anchor, 12, { months: 5, perMonth: 200 })
    for (let i = 0; i < 5; i++) {
      expect(projection[i].lines.find((l) => l.key === 'retroactive_bookkeeping')).toMatchObject({
        amount: 200,
        note: `installment ${i + 1}`,
      })
    }
    expect(projection[5].lines.find((l) => l.key === 'retroactive_bookkeeping')).toBeUndefined()
  })

  it('the retro block header carries the frequency pick and writes the answer', () => {
    const onRetroBillingChange = vi.fn()
    renderReview(answers, RETRO_QUOTE, { onRetroBillingChange })
    const select = screen.getByTestId('retro-billing-frequency')
    expect(select).toHaveValue('')
    fireEvent.change(select, { target: { value: 'quarterly' } })
    expect(onRetroBillingChange).toHaveBeenCalledWith('quarterly')
    // A picked frequency renders back from the answers.
    renderReview({ ...answers, retroBillingFrequency: 'quarterly' } as WizardAnswers, RETRO_QUOTE, {
      onRetroBillingChange,
    })
    expect(screen.getAllByTestId('retro-billing-frequency')[1]).toHaveValue('quarterly')
  })
})
