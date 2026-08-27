import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { flattenScreens, type WizardAnswers } from '../registry'

/**
 * Wizard mechanics: autosave debounce, option auto-advance timing, the live
 * quote rendering server numbers only, review edit-jump, and the duplicate
 * warning flow. Server actions are mocked; the registry is the real thing.
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
    totalMonthly: 100,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 0,
    effectiveMonthly: 425,
  },
}

const saveIntake = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { intake: {}, cascaded: false } }))
const getQuote = vi.fn(async (_answers: unknown) => ({ ok: true as const, data: QUOTE }))
const checkDuplicates = vi.fn(async (_input: unknown) => ({ ok: true as const, data: [] as unknown[] }))
const submitIntakeForReview = vi.fn(async (_id: unknown) => ({ ok: true as const, data: {} }))
const convertIntake = vi.fn(async (_id: unknown, _staff: unknown) => ({ ok: true as const, data: { clientId: 42 } }))

vi.mock('@/server/actions/intake', () => ({
  saveIntake: (input: unknown) => saveIntake(input),
  getQuote: (answers: unknown) => getQuote(answers),
  checkDuplicates: (input: unknown) => checkDuplicates(input),
  submitIntakeForReview: (id: unknown) => submitIntakeForReview(id),
  convertIntake: (id: unknown, staff: unknown) => convertIntake(id, staff),
}))

import { IntakeWizard, AUTO_ADVANCE_MS, SAVE_DEBOUNCE_MS, QUOTE_DEBOUNCE_MS } from '../wizard'

const noop = () => {}

function renderWizard(answers: WizardAnswers, initialScreenIndex?: number) {
  return render(
    <IntakeWizard
      intakeId={7}
      status="in_progress"
      initialAnswers={answers}
      initialScreenIndex={initialScreenIndex}
      canConvert
      managers={[{ id: 1, name: 'Dana Whitfield' }]}
      bookkeepers={[{ id: 2, name: 'Jorge Medina' }]}
      clientId={null}
    />,
  )
}

const completeAnswers: WizardAnswers = {
  legalName: 'Test Co',
  taxStructure: 'LLC',
  isExistingClient: false,
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
  qboUserCount: 2,
  bookkeepingStartDate: '2026-01-01',
  serviceKeys: ['bank_feed_management'],
  isRealEstateClient: false,
  hasPayroll: false,
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  accountingMethod: 'cash',
  includeBillPay: false,
  includeRetroactive: false,
}

beforeEach(() => {
  saveIntake.mockClear()
  getQuote.mockClear()
  getQuote.mockImplementation(async () => ({ ok: true as const, data: QUOTE }))
  checkDuplicates.mockClear()
  submitIntakeForReview.mockClear()
  checkDuplicates.mockResolvedValue({ ok: true, data: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('autosave', () => {
  it('debounces answer patches into one saveIntake call', async () => {
    vi.useFakeTimers()
    renderWizard({})
    const input = screen.getByLabelText('Legal name')
    fireEvent.change(input, { target: { value: 'Fern' } })
    fireEvent.change(input, { target: { value: 'Fern & Feather' } })
    expect(saveIntake).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    expect(saveIntake).toHaveBeenCalledTimes(1)
    const call = saveIntake.mock.calls[0]?.[0] as { intakeId: number; patch: { legalName?: string } }
    expect(call.intakeId).toBe(7)
    expect(call.patch.legalName).toBe('Fern & Feather')
  })
})

describe('option auto-advance', () => {
  it('advances shortly after an option pick, not instantly', async () => {
    vi.useFakeTimers()
    renderWizard({ legalName: 'Test Co' })
    // Resumes at tax-structure (legal name is already answered).
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')

    fireEvent.click(screen.getByTestId('option-LLC'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')

    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + 50)
    })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-id')
  })
})

describe('live quote panel', () => {
  it('renders server-returned figures only, with unpriced lines labeled', async () => {
    renderWizard(completeAnswers)
    await waitFor(() => expect(screen.getByTestId('quote-amount')).toHaveTextContent('$425'), { timeout: 3000 })
    expect(screen.getAllByText('Process Payroll').length).toBeGreaterThan(0)
    expect(screen.getAllByText('quoted at review').length).toBeGreaterThan(0)
    // The panel never shows a computed number for the unpriced line.
    expect(screen.queryByText('$0')).not.toBeInTheDocument()
  })

  it('posts the derived service keys to the server for pricing', async () => {
    renderWizard(completeAnswers)
    await waitFor(() => expect(getQuote).toHaveBeenCalled(), { timeout: 3000 })
    const sent = getQuote.mock.calls[0]?.[0] as { serviceKeys: string[] }
    expect(sent.serviceKeys).toContain('bank_feed_management')
    expect(sent.serviceKeys).toContain('monthly_reporting_10') // derived from close tier
  })
})

describe('quote panel: QBO recommendation and priced retroactive', () => {
  const QUOTE_WITH_EXTRAS: Quote = {
    billingCycle: 1,
    lines: [
      {
        service_key: 'bank_feed_management',
        product_name: 'Bank Feed Management',
        unit_price: 100,
        quantity: 1,
        amount: 100,
        bucket: 'monthly',
        unpriced: false,
      },
      {
        service_key: 'quickbooks_essentials',
        product_name: 'QuickBooks Essentials (pass-through)',
        unit_price: 60,
        quantity: 1,
        amount: 60,
        bucket: 'monthly',
        unpriced: false,
      },
      {
        service_key: 'retroactive_bookkeeping',
        product_name: 'Retroactive Bookkeeping',
        unit_price: 160,
        quantity: 7,
        amount: 1120,
        bucket: 'one_time',
        unpriced: false,
      },
    ],
    totals: {
      totalMonthly: 160,
      totalQuarterly: 0,
      annualExcludingFebruaryBilled: 0,
      totalPayrollMonthly: 0,
      totalFebruaryBilledAnnual: 0,
      totalOneTime: 1120,
      effectiveMonthly: 160,
    },
    qbo: { tier: 'essentials', serviceKey: 'quickbooks_essentials', recommended: true },
    retroactive: { months: 7, startMonth: { year: 2026, month: 1 }, perMonthRate: 160, total: 1120 },
  }

  it('names the recommended QBO tier and breaks retroactive out as one-time', async () => {
    getQuote.mockImplementation(async () => ({ ok: true as const, data: QUOTE_WITH_EXTRAS }))
    renderWizard(completeAnswers)
    await waitFor(() => expect(screen.getByTestId('quote-amount')).toHaveTextContent('$160'), { timeout: 3000 })

    // The pass-through line renders as the tier name, flagged recommended.
    expect(screen.getAllByText('QuickBooks Essentials (recommended)').length).toBeGreaterThan(0)
    // Retroactive gets its own one-time block, and the priced line itself
    // leaves the regular line list.
    const retro = screen.getByTestId('retroactive-summary')
    expect(retro).toHaveTextContent('$1,120 one-time')
    expect(retro).toHaveTextContent('7 months')
    expect(retro).toHaveTextContent('$160/mo')
    expect(screen.queryByText('Retroactive Bookkeeping')).not.toBeInTheDocument()
  })

  it('the review screen carries the recommended tier and the retroactive section', async () => {
    getQuote.mockImplementation(async () => ({ ok: true as const, data: QUOTE_WITH_EXTRAS }))
    const reviewIndex = flattenScreens(completeAnswers).length - 1
    renderWizard(completeAnswers, reviewIndex)
    await waitFor(() => expect(screen.getByTestId('review-quote')).toBeInTheDocument(), { timeout: 3000 })

    expect(screen.getAllByText('QuickBooks Essentials (recommended)').length).toBeGreaterThan(0)
    const section = screen.getByTestId('review-retroactive')
    expect(section).toHaveTextContent('$1,120')
    expect(section).toHaveTextContent('one-time')
    expect(section).toHaveTextContent('7 monthly line items')
    expect(section).toHaveTextContent('from Jan 2026')
    expect(section).toHaveTextContent('$160')
    // Not double-rendered in the main quote list.
    const quoteList = screen.getByTestId('review-quote')
    expect(quoteList).not.toHaveTextContent('Retroactive Bookkeeping')
  })
})

describe('review screen', () => {
  const reviewIndex = flattenScreens(completeAnswers).length - 1

  it('edit links jump back to the chapter question', async () => {
    renderWizard(completeAnswers, reviewIndex)
    expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('edit-business'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'legal-name')
  })

  it('duplicate matches render a warning with the reason, then submit anyway works', async () => {
    checkDuplicates.mockResolvedValue({
      ok: true,
      data: [{ id: 5, legalName: 'Test Co', dbaName: null, matchedOn: 'tax_id' }],
    })
    renderWizard(completeAnswers, reviewIndex)
    fireEvent.click(screen.getByTestId('submit-intake'))

    await waitFor(() => expect(screen.getByTestId('duplicate-warning')).toBeInTheDocument())
    expect(screen.getByText(/tax ID \(EIN\)/)).toBeInTheDocument()
    expect(submitIntakeForReview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('submit-anyway'))
    await waitFor(() => expect(screen.getByTestId('submitted-success')).toBeInTheDocument())
    expect(submitIntakeForReview).toHaveBeenCalledWith(7)
  })

  it('submits straight through when no duplicates match', async () => {
    renderWizard(completeAnswers, reviewIndex)
    fireEvent.click(screen.getByTestId('submit-intake'))
    await waitFor(() => expect(screen.getByTestId('submitted-success')).toBeInTheDocument())
    expect(submitIntakeForReview).toHaveBeenCalledWith(7)
  })
})
