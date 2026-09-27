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

describe('ReviewScreen I1 answer rendering', () => {  it('shows custom Other text verbatim, the CPA card, the referral who, and no catch-up row', () => {    render(
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
    // The CPA card folds name into the yes/no row (J1/C4: linked-vs-new state).
    expect(screen.getByText('Yes · Cascade Tax Group · new record')).toBeInTheDocument()
    // Referral folds in who to thank.
    expect(screen.getByText('CPA referral · Carlos at Cascade')).toBeInTheDocument()
    // The text-entry date renders as a real date label…
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
    expect(screen.getByText('When would you like your bookkeeping to start?')).toBeInTheDocument()
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument()
    // A45: the established date is its own row beside it.
    expect(screen.getByText('When was the business established?')).toBeInTheDocument()
    expect(screen.getByText('Mar 1, 2019')).toBeInTheDocument()
    // A41: both money-behavior cards carry review rows.
    expect(screen.getByText("Do they ever deposit anything that isn't business income?")).toBeInTheDocument()
    expect(screen.getByText('Do they ever pay for non-business things on business accounts?')).toBeInTheDocument()
    // The personal-card row (B18) still renders its own answer.
    expect(screen.getByText('Do they put business expenses on a personal credit card?')).toBeInTheDocument()
    // J2 (E1-E3): the mandatory notes render on the yes rows.
    expect(screen.getByText('Yes · Owner covers a bill from his personal account some months')).toBeInTheDocument()
    expect(screen.getByText('Yes · The Amex picks up supplies')).toBeInTheDocument()
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
    expect(screen.getByText('LLC · taxed as S Corp')).toBeInTheDocument()
    // The payroll row shows the derived auto-flag even with no stored answer.
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
          contacts: [{ firstName: 'Wren', isPrimary: true }],
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
    expect(screen.getByText('LLC · single-member')).toBeInTheDocument()
    // No auto-flag: the payroll row is a plain No.
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
    // 3 statement-proof accounts (checking, card, the vehicle loan); 1 checked.
    expect(screen.getByText('1 of 3 with online access')).toBeInTheDocument()
  })
})
