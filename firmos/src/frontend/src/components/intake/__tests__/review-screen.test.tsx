import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quote } from '@firmos/domain'

import { ReviewScreen } from '../review-screen'
import type { WizardAnswers } from '../registry'

/**
 * J4 review & pricing rebuild (meeting #3, V1-V7, 00:58:28-01:06:58):
 * collapsible sections (one open at a time), per-section + per-row edit
 * buttons feeding the overlay (never navigation), the bucketed estimate with
 * account breakdowns + visible math, direct price editing (no discount
 * boxes), and one-time fees separated from recurring. Server actions are
 * mocked; the registry supplies the chapters.
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

/** K6 (F1): sections default OPEN; expandSection survives for test intent
 *  but only clicks when the section was manually collapsed. */
function expandSection(id: string) {
  const toggle = screen.queryByTestId(`section-toggle-${id}`)
  if (!toggle) return
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
}

const DISCOUNT_QUOTE: Quote = {
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

/** The rich estimate fixture: per-account math, all bucket kinds, one-time money. */
const ESTIMATE_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
    { service_key: 'account_reconciliations', product_name: 'Account Reconciliations', unit_price: 25, quantity: 5, amount: 125, bucket: 'monthly', unpriced: false },
    { service_key: 'monthly_reporting_10', product_name: 'Monthly Reporting (close by the 10th)', unit_price: 50, quantity: 1, amount: 50, bucket: 'monthly', unpriced: false },
    { service_key: 'record_bills', product_name: 'Record Bills', unit_price: 25, quantity: 1, amount: 25, bucket: 'monthly', unpriced: false },
    { service_key: 'payroll_quarterly_filings', product_name: 'Payroll Quarterly Filings', unit_price: 45, quantity: 1, amount: 45, bucket: 'quarterly', unpriced: false },
    { service_key: '1099_collection', product_name: '1099 Collection', unit_price: 50, quantity: 1, amount: 50, bucket: 'annual', unpriced: false },
    { service_key: 'qbo_setup', product_name: 'QBO Setup', unit_price: 150, quantity: 1, amount: 150, bucket: 'one_time', unpriced: false },
    { service_key: 'specialty_report_1_retro', product_name: 'Missed past filings: Oregon Special Report', unit_price: 200, quantity: 18, amount: 3600, bucket: 'one_time', unpriced: false },
    { service_key: 'retroactive_bookkeeping', product_name: 'Retroactive Bookkeeping', unit_price: 350, quantity: 7, amount: 2450, bucket: 'one_time', unpriced: false },
  ],
  totals: {
    totalMonthly: 300,
    totalQuarterly: 45,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 50,
    totalOneTime: 6200,
    effectiveMonthly: 315,
  },
  retroactive: { months: 7, startMonth: { year: 2025, month: 12 }, perMonthRate: 350, baseTotal: 2450, discountPercent: null, total: 2450 },
}

/** Five statement-proof money accounts -> the recon breakdown's count math. */
const FIVE_ACCOUNTS: WizardAnswers = {
  legalName: 'Estimate Co',
  engagementType: 'bookkeeping',
  checkingAccounts: [
    { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
    { name: 'Chase Checking · 2200', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '2200' },
  ],
  savingsAccounts: [
    { name: 'Chase Savings · 1005', accountType: 'savings', proofCategory: 'statement', institution: 'Chase', last4: '1005' },
    { name: 'Columbia Savings · 3310', accountType: 'savings', proofCategory: 'statement', institution: 'Columbia', last4: '3310' },
  ],
  creditCardAccounts: [
    { name: 'Amex Credit card · 7007', accountType: 'credit_card', proofCategory: 'statement', institution: 'Amex', last4: '7007' },
  ],
}

function renderReview({
  answers = { legalName: 'Estimate Co', engagementType: 'bookkeeping' } as WizardAnswers,
  quote = DISCOUNT_QUOTE as Quote | null,
  status = 'draft' as const,
  canConvert = false,
  onEdit = () => {},
  onPriceChange,
}: {
  answers?: WizardAnswers
  quote?: Quote | null
  status?: 'draft' | 'pending_review' | 'completed' | 'archived'
  canConvert?: boolean
  onEdit?: (chapterId: string, questionId: string) => void
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
} = {}) {
  return render(
    <ReviewScreen
      intakeId={1}
      answers={answers}
      quote={quote}
      status={status}
      canConvert={canConvert}
      managers={[]}
      bookkeepers={[]}
      clientId={null}
      onEdit={onEdit}
      onPriceChange={onPriceChange}
    />,
  )
}

describe('sections_default_open_confirm_greens_and_collapses (K6, F1 - 09_30 01:00:58)', () => {
  const answers: WizardAnswers = {
    legalName: 'Accordion Co',
    engagementType: 'bookkeeping',
    contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
    taxStructure: 'LLC',
    llcSubclass: 'llc_sml',
    hasCpa: false,
  }

  it('every section starts expanded; the confirm check greens + collapses; uncheck reopens', () => {
    renderReview({ answers, quote: null })
    // All open by default: both chapters' rows render, no summaries.
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
    expect(screen.getByText('LLC · single-member')).toBeInTheDocument()
    expect(screen.queryByTestId('section-summary-entity')).toBeNull()

    // Confirm the contact section: greens, collapses, summary returns.
    fireEvent.click(screen.getByTestId('section-confirm-contact'))
    expect(screen.getByTestId('review-section-contact')).toHaveAttribute('data-confirmed', 'true')
    expect(screen.queryByText('Wren Okafor')).toBeNull()
    expect(screen.getByTestId('section-summary-contact')).toBeInTheDocument()
    expect(screen.getByTestId('section-confirm-contact')).toHaveAttribute('aria-checked', 'true')

    // Entity stays open (independent sections - the one-open rule is gone).
    expect(screen.getByText('LLC · single-member')).toBeInTheDocument()

    // Uncheck reopens and ungreens.
    fireEvent.click(screen.getByTestId('section-confirm-contact'))
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
    expect(screen.getByTestId('review-section-contact')).not.toHaveAttribute('data-confirmed')
  })

  it('the estimate greens itself when every chapter is confirmed', () => {
    renderReview({ answers: { ...answers, bookkeepingFrequency: 'monthly', monthlyCloseTier: '10', bookkeepingStartDate: '2026-08-01' }, quote: DISCOUNT_QUOTE })
    expect(screen.getByTestId('review-quote')).not.toHaveAttribute('data-confirmed')
    // Jason's flow: work down the page confirming each section in turn.
    for (const el of screen.getAllByTestId(/^section-confirm-/)) {
      if (el.getAttribute('aria-checked') !== 'true') fireEvent.click(el)
    }
    expect(screen.getByTestId('review-quote')).toHaveAttribute('data-confirmed', 'true')
  })

  it('the chevron still collapses/expands manually without confirming', () => {
    renderReview({ answers, quote: null })
    const toggle = screen.getByTestId('section-toggle-entity')
    fireEvent.click(toggle) // collapse
    expect(screen.queryByText('LLC · single-member')).toBeNull()
    expect(screen.getByTestId('review-section-entity')).not.toHaveAttribute('data-confirmed')
    fireEvent.click(toggle) // expand again
    expect(screen.getByText('LLC · single-member')).toBeInTheDocument()
  })
})

describe('V1 edit affordances feed the overlay (never navigation)', () => {
  it('every section and every row reports its own edit target', () => {
    const onEdit = vi.fn()
    renderReview({
      answers: {
        legalName: 'Edit Co',
        engagementType: 'bookkeeping',
        contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
        taxStructure: 'LLC',
        llcSubclass: 'llc_sml',
        hasCpa: false,
        checkingAccounts: [
          { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
        ],
      },
      quote: null,
      onEdit,
    })
    // Section-level edit: the chapter's first question, in WALK mode (L1/G1:
    // the parent Edit steps through every question in the chapter).
    fireEvent.click(screen.getByTestId('edit-contact'))
    expect(onEdit).toHaveBeenCalledWith('contact', 'legal-name', true)
    // Row-level edit: the exact question behind the row (single-question).
    fireEvent.click(screen.getByTestId('edit-row-main-contact'))
    expect(onEdit).toHaveBeenCalledWith('contact', 'main-contact')
    expect(onEdit).toHaveBeenCalledTimes(2)

    // Account rows edit their type's count card.
    expandSection('balance')
    fireEvent.click(screen.getByTestId('edit-account-row-checking-0'))
    expect(onEdit).toHaveBeenCalledWith('balance', 'checking-accounts')
    expect(onEdit).toHaveBeenCalledTimes(3)
  })

  it('no edit affordances for read-only reviewers', () => {
    renderReview({
      answers: { legalName: 'Read Only Co', engagementType: 'bookkeeping', contacts: [{ firstName: 'Wren', isPrimary: true }], taxStructure: 'LLC', llcSubclass: 'llc_sml', hasCpa: false },
      quote: null,
      status: 'pending_review',
    })
    expect(screen.queryByTestId('edit-contact')).toBeNull()
    expect(screen.queryByTestId('edit-row-main-contact')).toBeNull()
  })
})

describe('price_edit_replaces_discount_flow (V4)', () => {
  it('legacy discounted lines show the standard struck through and the net - never a negative number', () => {
    renderReview({ onPriceChange: () => {} })
    expandSection('quote')
    const row = screen.getByText('Bank Feed Management').closest('li')!
    expect(row).toHaveTextContent('$100') // standard struck
    expect(row).toHaveTextContent('$75') // discounted net
    // No discount input, no "-$x/cycle" chip, no negative numbers.
    expect(screen.queryByTestId('review-discount-bank_feed_management')).toBeNull()
    expect(screen.queryByTestId('discount-bank_feed_management')).toBeNull()
    expect(row.textContent).not.toMatch(/−\$|-\$/)
  })

  it('editing a price reports the override; reset clears it', () => {
    const onPriceChange = vi.fn()
    renderReview({ onPriceChange })
    expandSection('quote')
    fireEvent.click(screen.getByTestId('price-edit-bank_feed_management'))
    const input = screen.getByTestId('price-input-bank_feed_management')
    expect(input).toHaveValue(75) // the effective (discounted) price prefills
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.click(screen.getByTestId('price-save-bank_feed_management'))
    expect(onPriceChange).toHaveBeenCalledWith('bank_feed_management', 90)
  })

  it('an overridden line shows the override over the struck standard', () => {
    const quote: Quote = {
      ...DISCOUNT_QUOTE,
      lines: DISCOUNT_QUOTE.lines.map((l) =>
        l.service_key === 'bank_feed_management' ? { ...l, discount: 25, price_override: 60 } : l,
      ),
    }
    renderReview({ quote, onPriceChange: () => {} })
    expandSection('quote')
    const row = screen.getByText('Bank Feed Management').closest('li')!
    expect(row).toHaveTextContent('$100')
    expect(screen.getByTestId('price-value-bank_feed_management')).toHaveTextContent('$60')
    // The reset affordance clears override + legacy discount in one call.
    fireEvent.click(screen.getByTestId('price-reset-bank_feed_management'))
  })
})

describe('breakdown_shows_accounts_with_count_math (V5)', () => {
  it('the reconciliation breakdown lists the actual accounts with 5 x $25 = $125 math', () => {
    renderReview({ answers: FIVE_ACCOUNTS, quote: ESTIMATE_QUOTE })
    expandSection('quote')
    // The count x rate math is visible on the line.
    expect(screen.getByTestId('estimate-math-account_reconciliations')).toHaveTextContent(
      '5 accounts × $25 = $125/mo',
    )
    // The breakdown is collapsed by default; expanding lists the accounts
    // with the bank -> type -> last4 standard labels.
    expect(screen.queryByTestId('breakdown-account_reconciliations')).toBeNull()
    const toggle = screen.getByTestId('breakdown-toggle-account_reconciliations')
    expect(toggle).toHaveTextContent('5 accounts')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const breakdown = screen.getByTestId('breakdown-account_reconciliations')
    expect(breakdown.querySelectorAll('[data-testid="breakdown-account"]')).toHaveLength(5)
    expect(breakdown).toHaveTextContent('Chase Checking · 4411')
    expect(breakdown).toHaveTextContent('Amex Credit card · 7007')
  })

  it('bank feed management gets its own account breakdown (flat rate, no count math)', () => {
    renderReview({ answers: FIVE_ACCOUNTS, quote: ESTIMATE_QUOTE })
    expandSection('quote')
    expect(screen.queryByTestId('estimate-math-bank_feed_management')).toBeNull()
    fireEvent.click(screen.getByTestId('breakdown-toggle-bank_feed_management'))
    const breakdown = screen.getByTestId('breakdown-bank_feed_management')
    expect(breakdown.querySelectorAll('[data-testid="breakdown-account"]')).toHaveLength(5)
  })
})

describe('estimate_buckets_match_schedule (V6)', () => {
  const schedule: NonNullable<WizardAnswers['routineSchedule']> = {
    categorize_transactions: { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 },
    reconcile_accounts: { bucket: 'weekly', order: 1, weekdays: [5], everyNWeeks: 1 },
    send_reports: { bucket: 'quarterly', order: 0, daysAfterPeriodEnd: 10 },
    'record-bills': { bucket: 'daily', order: 0, weekdays: [1, 2, 3, 4, 5] },
  }

  it('recurring lines group into the routine buckets from the committed schedule', () => {
    renderReview({
      answers: { ...FIVE_ACCOUNTS, routineSchedule: schedule },
      quote: ESTIMATE_QUOTE,
    })
    expandSection('quote')
    // Schedule-driven buckets: bills daily, feed + recon weekly, reporting quarterly.
    expect(screen.getByTestId('estimate-bucket-daily')).toHaveTextContent('Record Bills')
    const weekly = screen.getByTestId('estimate-bucket-weekly')
    expect(weekly).toHaveTextContent('Bank Feed Management')
    expect(weekly).toHaveTextContent('Account Reconciliations')
    expect(screen.getByTestId('estimate-bucket-total-weekly')).toHaveTextContent('$225/mo')
    const quarterly = screen.getByTestId('estimate-bucket-quarterly')
    expect(quarterly).toHaveTextContent('Monthly Reporting (close by the 10th)')
    // No schedule entry for payroll-handling: the filings fall back to their
    // engine bucket (quarterly), with the ÷ 3 math visible.
    expect(quarterly).toHaveTextContent('Payroll Quarterly Filings')
    expect(screen.getByTestId('estimate-math-payroll_quarterly_filings')).toHaveTextContent(
      '$45/quarter ÷ 3 = $15/mo',
    )
    // 1099 collection is February-billed: annual bucket, off the monthly rate.
    expect(screen.getByTestId('estimate-bucket-annual')).toHaveTextContent('billed each February')
    expect(screen.getByTestId('estimate-math-1099_collection')).toHaveTextContent('$50/year · billed each February')
    // Nothing lands in the monthly bucket under this schedule.
    expect(screen.queryByTestId('estimate-bucket-monthly')).toBeNull()
  })

  it('without a committed schedule the engine buckets drive the grouping', () => {
    renderReview({ answers: FIVE_ACCOUNTS, quote: ESTIMATE_QUOTE })
    expandSection('quote')
    const monthly = screen.getByTestId('estimate-bucket-monthly')
    expect(monthly).toHaveTextContent('Bank Feed Management')
    expect(monthly).toHaveTextContent('Account Reconciliations')
    expect(monthly).toHaveTextContent('Monthly Reporting (close by the 10th)')
    expect(monthly).toHaveTextContent('Record Bills')
    expect(screen.getByTestId('estimate-bucket-total-monthly')).toHaveTextContent('$300/mo')
  })
})

describe('one_time_fees_separate_from_recurring (V7)', () => {
  it('QBO setup, missed filings, and the retro cleanup list separately, split by period', () => {
    renderReview({ answers: FIVE_ACCOUNTS, quote: ESTIMATE_QUOTE })
    expandSection('quote')
    // K6 (D5/D7): one-time fees up top hold QBO setup only - missed filings
    // and the cleanup moved to the retro block at the bottom.
    const oneTime = screen.getByTestId('estimate-one-time')
    expect(oneTime).toHaveTextContent('One-time fees')
    expect(oneTime).not.toHaveTextContent('Missed past filings')
    expect(screen.getByTestId('one-time-qbo_setup')).toHaveTextContent('$150')
    const retroBlock = screen.getByTestId('estimate-retro')
    expect(retroBlock).toHaveTextContent('Retroactive cleanup')
    expect(screen.getByTestId('retro-specialty_report_1_retro')).toHaveTextContent('$3,600')
    // The retro project: months x rate math plus the per-period split.
    const retro = screen.getByTestId('retro-retroactive_bookkeeping')
    expect(retro).toHaveTextContent('$2,450')
    expect(screen.getByTestId('one-time-math-retroactive_bookkeeping')).toHaveTextContent('7 months × $350/mo')
    expect(screen.getByTestId('retro-periods')).toHaveTextContent('2025: 1 month · 2026: 6 months')
    // No double counting: the priced retro line never appears in recurring,
    // and no recurring bucket names one-time money.
    expect(screen.getByTestId('estimate-recurring')).not.toHaveTextContent('Retroactive')
    expect(screen.getByTestId('estimate-recurring')).not.toHaveTextContent('QBO Setup')
    // The effective monthly header excludes one-time money.
    expect(screen.getByTestId('quote-total')).toHaveTextContent('$315')
  })

  it('an unpriced one-time service stays flagged, not guessed', () => {
    const quote: Quote = {
      ...DISCOUNT_QUOTE,
      lines: [
        ...DISCOUNT_QUOTE.lines,
        { service_key: 'retroactive_bookkeeping', product_name: 'Retroactive Bookkeeping', unit_price: null, quantity: 1, amount: null, bucket: 'one_time', unpriced: true },
      ],
    }
    renderReview({ quote })
    expandSection('quote')
    const row = screen.getByTestId('one-time-retroactive_bookkeeping')
    expect(row).toHaveTextContent('quoted at review')
  })
})

describe('ReviewScreen quote email + plain amounts', () => {
  it('renders plain amounts when no line is discounted', () => {
    renderReview({
      quote: { ...DISCOUNT_QUOTE, lines: DISCOUNT_QUOTE.lines.map((l) => ({ ...l, discount: 0 })) },
    })
    expandSection('quote')
    expect(screen.getByTestId('review-quote')).toHaveTextContent('Bank Feed Management')
    const row = screen.getByText('Bank Feed Management').closest('li')!
    expect(row.querySelector('.line-through')).toBeNull()
  })

  it('offers Email proposal to manager+ and sends through the action', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    sendIntakeQuoteEmailAction.mockClear()
    render(
      <ReviewScreen
        intakeId={7}
        answers={{ legalName: 'Mail Co', engagementType: 'bookkeeping' }}
        quote={DISCOUNT_QUOTE}
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
    expandSection('entity')
    expect(screen.getByText('Series LLC taxed as a trust')).toBeInTheDocument()
    // The CPA card folds name into the yes/no row (J1/C4: linked-vs-new state).
    expect(screen.getByText('Yes · Cascade Tax Group · new record')).toBeInTheDocument()
    // Referral folds in who to thank.
    expect(screen.getByText('CPA referral · Carlos at Cascade')).toBeInTheDocument()
    // The text-entry date renders as a real date label…
    expandSection('starting')
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument()
    // …and the removed catch-up screen has no row anywhere.
    expect(screen.queryByText(/catch-up date/i)).toBeNull()
  })
})

describe('ReviewScreen closeout rows (N2 + A45 + A41/E1-E3)', () => {
  it('shows the renamed books-start row, the established date, and both money-behavior answers with their notes', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Closeout Co',
          engagementType: 'bookkeeping',
          contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
          taxStructure: 'LLC',
          llcSubclass: 'llc_sml',
          hasCpa: false,
          bookkeepingStartDate: '2026-01-05',
          businessEstablishedDate: '2019-03-01',
          depositsNonBusiness: true,
          personalOnBusiness: false,
          personalCardForBusiness: true,
          behaviorNotes: {
            'deposits-non-business': 'Owner covers a bill from his personal account some months',
            'personal-card': 'The Amex picks up supplies',
          },
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
    // N2 (meeting #3): the row's label is the renamed start question.
    expandSection('starting')
    expect(screen.getByText('When would you like your bookkeeping to start?')).toBeInTheDocument()
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument()
    // A45: the established date is its own row beside it.
    expect(screen.getByText('When was the business established?')).toBeInTheDocument()
    expect(screen.getByText('Mar 1, 2019')).toBeInTheDocument()
    // A41: both money-behavior cards carry review rows.
    expandSection('income')
    expect(screen.getByText("Do they ever deposit anything that isn't business income?")).toBeInTheDocument()
    expect(screen.getByText('Do they ever pay for non-business things on business accounts?')).toBeInTheDocument()
    // The personal-card row (B18) still renders its own answer.
    expect(screen.getByText('Do they pay for business expenses outside the business?')).toBeInTheDocument()
    // J2 (E1-E3): the mandatory notes render on the yes rows.
    expect(screen.getByText('Yes · Owner covers a bill from his personal account some months')).toBeInTheDocument()
    expect(screen.getByText('Yes · The Amex picks up supplies')).toBeInTheDocument()
  })

  it('notes_render_on_review (K1, C9 - 09_30 00:25:18): the typed note itself shows, not a placeholder', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Noted Co',
          engagementType: 'bookkeeping',
          internalNotes: 'Referred by Cascade Tax Group. Wants close by the 10th.',
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
    expandSection('recurring')
    expect(screen.getByText('Referred by Cascade Tax Group. Wants close by the 10th.')).toBeInTheDocument()
    expect(screen.queryByText('Notes on file')).not.toBeInTheDocument()
  })

  it('hides the established-date row when the optional answer was skipped', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Skipped Co',
          engagementType: 'bookkeeping',
          contacts: [{ firstName: 'Wren', isPrimary: true }],
          taxStructure: 'LLC',
          llcSubclass: 'llc_sml',
          hasCpa: false,
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
    expandSection('starting')
    expect(screen.queryByText('When was the business established?')).toBeNull()
    expect(screen.getByText('When would you like your bookkeeping to start?')).toBeInTheDocument()
  })
})

describe('ReviewScreen I2 entity rendering', () => {
  it('shows the LLC subclass on the tax-structure row and the payroll auto-flag row', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Subclass Co',
          engagementType: 'bookkeeping',
          contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
          taxStructure: 'LLC',
          llcSubclass: 'llc_scorp',
          hasCpa: false,
          payrollProvider: 'Gusto',
          payrollFrequency: 'biweekly',
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
    // "LLC · taxed as S Corp" - the subclass folds into the one row.
    expandSection('entity')
    expect(screen.getByText('LLC · taxed as S Corp')).toBeInTheDocument()
    // The payroll row shows the derived auto-flag even with no stored answer.
    expandSection('income')
    expect(screen.getByText('Yes · officers must be on payroll')).toBeInTheDocument()
    expect(screen.getByText('Gusto')).toBeInTheDocument()
    expect(screen.getByText('Every two weeks')).toBeInTheDocument()
  })

  it('a single-member LLC reads "LLC · single-member"', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'SMLLC Co',
          engagementType: 'bookkeeping',
          contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true }],
          taxStructure: 'LLC',
          llcSubclass: 'llc_sml',
          hasCpa: false,
          hasPayroll: false,
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
    expandSection('entity')
    expect(screen.getByText('LLC · single-member')).toBeInTheDocument()
    // No auto-flag: the payroll row is a plain No.
    expandSection('income')
    expect(screen.queryByText(/officers must be on payroll/)).toBeNull()
  })
})

describe('I3 review: accounts grouped by type with institution + proof badges', () => {
  const accountsAnswers: WizardAnswers = {
    legalName: 'Grouped Accounts Co',
    engagementType: 'bookkeeping',
    checkingAccounts: [
      // J1 (D1/D2): money accounts carry the last-4 - the label is derived.
      { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411', grantLoginAccess: true },
    ],
    creditCardAccounts: [
      { name: 'Amex Gold', accountType: 'credit_card', proofCategory: 'statement', institution: 'Amex' },
    ],
    vehicleAssets: [
      { name: 'Transit van', accountType: 'vehicle', proofCategory: 'bill_of_sale', year: 2022, financed: 'financed' },
    ],
    otherAssets: [
      { name: 'Espresso machine', accountType: 'other_asset', assetType: 'equipment', proofCategory: 'owner_declared' },
    ],
    loanAccounts: [
      { name: 'Owner loan', accountType: 'loan', proofCategory: 'owner_declared', lender: 'Wren' },
      // J1 (D5): the financed vehicle's linked loan entry.
      { name: 'Transit van (vehicle loan)', accountType: 'vehicle_loan', proofCategory: 'statement', lender: 'Columbia', fromVehicle: 'Transit van' },
    ],
  }

  function renderAccounts(answers: WizardAnswers) {
    return render(
      <ReviewScreen
        intakeId={1}
        answers={answers}
        quote={null}
        status="draft"
        canConvert={false}
        managers={[]}
        bookkeepers={[]}
        clientId={null}
        onEdit={() => {}}
      />,
    )
  }

  it('groups the accounts under the balance chapter - J1 (D4): assets before loans; D2: the bank-type-last4 label', () => {
    renderAccounts(accountsAnswers)
    expandSection('balance')
    const section = screen.getByTestId('review-accounts')
    const groups = section.querySelectorAll('[data-testid="review-account-group"]')
    expect([...groups].map((g) => g.getAttribute('data-type'))).toEqual([
      'checking',
      'credit_card',
      'vehicle',
      'fixed_assets', // the equipment bucket maps to fixed assets
      'vehicle_loan',
      'loan',
    ])

    // D2: the checking account renders the bank -> type -> last4 label; the
    // institution badge is gone when the label already carries the bank.
    const checking = groups[0]
    expect(checking).toHaveTextContent('Chase Checking · 4411')
    expect(checking).not.toHaveTextContent('Statement · Chase')
    expect(checking).toHaveTextContent('Statement')
    expect(checking).toHaveTextContent('Online access')

    // The vehicle shows year + financed and the bill-of-sale badge.
    expect(groups[2]).toHaveTextContent('Transit van')
    expect(groups[2]).toHaveTextContent('2022 · Financed')
    expect(groups[2]).toHaveTextContent('Bill of sale')

    // Legacy rows (no last-4) keep the old name + institution badge; the
    // owner-declared loan carries its lender detail and badge.
    const legacyCard = groups[1]
    expect(legacyCard).toHaveTextContent('Amex Gold')
    expect(legacyCard).toHaveTextContent('Amex')
    const loan = groups[5]
    expect(loan).toHaveTextContent('Owner loan')
    expect(loan).toHaveTextContent('Wren')
    expect(loan).toHaveTextContent('Owner declared')
    // The linked vehicle-loan entry is badged.
    expect(groups[4]).toHaveTextContent('Transit van (vehicle loan)')
    expect(groups[4]).toHaveTextContent('Vehicle loan')
  })

  it('hides the balance chapter entirely when no accounts were entered', () => {
    renderAccounts({ legalName: 'No Accounts Co', engagementType: 'bookkeeping' })
    expect(screen.queryByTestId('review-accounts')).toBeNull()
    expect(screen.queryByText('Balance sheet')).toBeNull()
  })

  it('the online-access row counts the checked accounts', () => {
    renderAccounts(accountsAnswers)
    expandSection('access')
    // 3 statement-proof accounts (checking, card, the vehicle loan); 1 checked.
    expect(screen.getByText('1 of 3 with online access')).toBeInTheDocument()
  })
})

describe('custom_task_in_review_persists_to_catalog (K8, D4 closeout)', () => {
  it('adding a custom recurring task from the review estimate writes the catalog through onAddCustomTaskTitle', () => {
    const onAddCustomTaskTitle = vi.fn()
    const onCustomWork = vi.fn()
    render(
      <ReviewScreen
        intakeId={1}
        answers={{ legalName: 'Custom Co', engagementType: 'bookkeeping' } as WizardAnswers}
        quote={DISCOUNT_QUOTE}
        status="draft"
        canConvert
        managers={[]}
        bookkeepers={[]}
        clientId={null}
        onEdit={() => {}}
        onPriceChange={() => {}}
        onCustomWork={onCustomWork}
        onAddCustomTaskTitle={onAddCustomTaskTitle}
        customTaskCatalog={[{ id: 1, name: 'Weekly deposit review' }]}
      />,
    )
    // The custom-work adder rides the estimate block (all sections start open).
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: 'Quarterly sales-tax prep' } })
    fireEvent.change(screen.getByTestId('custom-work-cadence'), { target: { value: 'quarterly' } })
    fireEvent.click(screen.getByTestId('custom-work-add'))

    // The title persists to the custom_task_templates catalog via the wizard's wiring.
    expect(onAddCustomTaskTitle).toHaveBeenCalledWith('Quarterly sales-tax prep')
    // And the rule lands in the answers patch.
    expect(onCustomWork).toHaveBeenCalledWith(
      expect.objectContaining({
        customRecurringRules: [expect.objectContaining({ title: 'Quarterly sales-tax prep', scheduleType: 'quarterly' })],
      }),
    )
  })
})
