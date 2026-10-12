import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import {
  findQuestion,
  flattenScreens,
  formContactHits,
  type WizardAnswers,
} from '../registry'
import { DateTextInput, QuestionScreen } from '../screens'
import { dateTextToIso } from '../date-text'
import { ReviewScreen } from '../review-screen'

/**
 * M5 (10_10, meeting #5): the intake-polish pins -
 *  C2 (00:02:57): the main contact holds multiple emails/phones (widget).
 *  C3 (00:04:46): the pickers pull people entered earlier ON THIS FORM.
 *  C4 (00:06:33): 2-digit years expand to 20YY while typing.
 *  C5 (00:25:29): an existing QuickBooks skips plan + user-count.
 *  C6 (00:18:39): cash/accrual gets an "I don't know" option.
 *  C7 (00:19:36): deposits ask record AND make.
 *  C8 (00:18:39): the loans card asks online access at selection time.
 *  E2 (00:39:19): the review's balance boxes follow GAAP order.
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

const bookkeeping = { engagementType: 'bookkeeping' } as WizardAnswers

function questionIds(a: WizardAnswers): string[] {
  return flattenScreens(a)
    .filter((s) => s.kind === 'question')
    .map((s) => s.questionId!)
}

describe('M5/C4: two_digit_year_expands_to_20xx (10_10 00:06:33)', () => {
  it('dateTextToIso reads a 2-digit year as 20YY and returns the full ISO', () => {
    expect(dateTextToIso('01/01/25')).toBe('2025-01-01')
    expect(dateTextToIso('02/28/26')).toBe('2026-02-28')
    expect(dateTextToIso('01/01/2025')).toBe('2025-01-01')
    // Not real dates stay null either way.
    expect(dateTextToIso('13/01/25')).toBeNull()
  })

  it('typing the 6th digit inserts the "20" - still editable afterwards', () => {
    const changes: (string | null)[] = []
    render(<DateTextInput label="Start date" value={null} onChange={(iso) => changes.push(iso)} />)
    const input = screen.getByLabelText('Start date')
    fireEvent.change(input, { target: { value: '010125' } })
    expect(input).toHaveValue('01/01/2025')
    expect(changes.at(-1)).toBe('2025-01-01')
    // Jason: "then from there you could change it if you wanted to" - the
    // year digits stay ordinary editable text.
    fireEvent.change(input, { target: { value: '01/01/2024' } })
    expect(changes.at(-1)).toBe('2024-01-01')
  })

  it('an 8-digit typist still lands on the real year (the expansion steps aside)', () => {
    // Playwright's pressSequentially('01012026') fires one change per digit,
    // each landing in the MASKED display (slashes included): the 6-digit
    // expansion flashes, then the typed 7th/8th digits replace the inserted
    // "20" - the date must end at 2026, never 2020.
    const changes: (string | null)[] = []
    render(<DateTextInput label="Start date" value={null} onChange={(iso) => changes.push(iso)} />)
    const input = screen.getByLabelText('Start date')
    for (const v of ['0', '01', '010', '0101', '01/012', '01/01/20', '01/01/20202', '01/01/2026']) {
      fireEvent.change(input, { target: { value: v } })
    }
    expect(input).toHaveValue('01/01/2026')
    expect(changes.at(-1)).toBe('2026-01-01')
    // One-shot paste of 8 digits never triggers the expansion either.
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '01052026' } })
    expect(input).toHaveValue('01/05/2026')
    expect(changes.at(-1)).toBe('2026-01-05')
  })
})

describe('M5/C5: existing_qbo_skips_plan_and_user_count (10_10 00:25:29)', () => {
  it('an existing QuickBooks hides qbo-users and qbo-tier; desktop/none keep them', () => {
    const existing = questionIds({ ...bookkeeping, quickbooksStatus: 'existing' } as WizardAnswers)
    expect(existing).toContain('qbo-status')
    expect(existing).not.toContain('qbo-users')
    expect(existing).not.toContain('qbo-tier')
    expect(existing).not.toContain('qbo-setup')

    for (const status of ['desktop', 'none'] as const) {
      const ids = questionIds({ ...bookkeeping, quickbooksStatus: status } as WizardAnswers)
      expect(ids).toContain('qbo-users')
      expect(ids).toContain('qbo-tier')
    }
  })
})

describe('M5/C6: accounting_method_allows_idk (10_10 00:18:39)', () => {
  const q = findQuestion('reporting', 'acct-method')!

  it('the IDK option stores null + the answered flag, and reads back as idk', () => {
    expect(q.options!.map((o) => o.value)).toEqual(['cash', 'accrual', 'idk'])
    const applied = q.apply(bookkeeping, 'idk') as WizardAnswers
    expect(applied.accountingMethod ?? null).toBeNull()
    expect(applied.accountingMethodAnswered).toBe(true)
    const next = { ...bookkeeping, ...applied }
    expect(q.get(next)).toBe('idk')
    expect(q.summarize!(next)).toBe('Confirm at setup')
    // A real pick clears the ambiguity.
    const cash = { ...bookkeeping, ...q.apply(bookkeeping, 'cash') }
    expect(cash.accountingMethod).toBe('cash')
    expect(q.get(cash)).toBe('cash')
    expect(q.summarize!(cash)).toBe('cash basis')
  })
})

describe('M5/C7: deposits_asks_record_and_make (10_10 00:19:36)', () => {
  it('make-deposits follows record-deposits = yes only, storing a boolean', () => {
    const withoutRecord = questionIds({ ...bookkeeping, recordDeposits: false } as WizardAnswers)
    expect(withoutRecord).toContain('record-deposits')
    expect(withoutRecord).not.toContain('make-deposits')

    const withRecord = questionIds({ ...bookkeeping, recordDeposits: true } as WizardAnswers)
    const recordIdx = withRecord.indexOf('record-deposits')
    const makeIdx = withRecord.indexOf('make-deposits')
    expect(makeIdx).toBeGreaterThan(recordIdx)

    const q = findQuestion('income', 'make-deposits')!
    const applied = q.apply(bookkeeping, 'yes') as WizardAnswers
    expect(applied.makeDeposits).toBe(true)
    expect(q.get({ ...bookkeeping, makeDeposits: true } as WizardAnswers)).toBe('yes')
    expect(q.summarize!({ ...bookkeeping, recordDeposits: true, makeDeposits: false } as WizardAnswers)).toBe('No')
    // The summary hides when deposits are not recorded at all.
    expect(q.summarize!({ ...bookkeeping, recordDeposits: false } as WizardAnswers)).toBeNull()
  })
})

describe('M5/C8: loans_ask_online_access_at_selection_time (10_10 00:18:39)', () => {
  it('every count-card def with a statement proof asks for login access', async () => {
    const { ACCOUNT_COUNT_DEFS } = await import('../registry')
    for (const key of ['checkingAccounts', 'savingsAccounts', 'creditCardAccounts', 'loanAccounts'] as const) {
      expect(ACCOUNT_COUNT_DEFS.find((d) => d.answerKey === key)?.askLoginAccess).toBe(true)
    }
  })
})

describe('M5/C3: referral_pulls_cpa_entered_earlier (10_10 00:04:46)', () => {
  const answers = {
    ...bookkeeping,
    contacts: [
      { firstName: 'Wren', lastName: 'Okafor', email: 'wren@fern.shop', phone: '5035550182', isPrimary: true, relationshipType: 'primary_contact' },
    ],
    owners: [{ name: 'Wren Okafor', email: 'wren@fern.shop' }],
    cpaName: 'Reyes Tax Group',
  } as unknown as WizardAnswers

  it('the main contact, owners, and the CPA become form-local hits', () => {
    const names = formContactHits(answers, '').map((h) => h.name)
    expect(names).toEqual([
      "Wren Okafor (this form's main contact)",
      'Wren Okafor (owner on this form)',
      'Reyes Tax Group (CPA on this form)',
    ])
  })

  it('hits carry id -1 without a DB link (never a fake FK), and the query filters', () => {
    const cpa = formContactHits(answers, 'reyes')
    expect(cpa).toHaveLength(1)
    expect(cpa[0].id).toBe(-1)
    expect(cpa[0].entityName).toBe('Reyes Tax Group')
    // Email matches too.
    expect(formContactHits(answers, 'wren@fern').length).toBeGreaterThan(0)
    expect(formContactHits(answers, 'nobody')).toHaveLength(0)
    // A linked contact keeps its real id.
    const linked = {
      ...answers,
      cpaContactId: 42,
    } as WizardAnswers
    expect(formContactHits(linked, 'reyes')[0].id).toBe(42)
  })
})

describe('M5/C2: contact_channels_widget (10_10 00:02:57)', () => {
  function Harness() {
    const [answers, setAnswers] = useState<WizardAnswers>({ engagementType: 'bookkeeping' } as WizardAnswers)
    return (
      <QuestionScreen
        q={findQuestion('contact', 'main-contact')!}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
      />
    )
  }

  it('the main-contact card adds and removes extra emails/phones', () => {
    render(<Harness />)
    const channels = screen.getByTestId('contact-channels')

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Wren Okafor' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'wren@fern.shop' } })

    // Add two extra emails and one extra phone.
    fireEvent.click(within(channels).getByTestId('channel-email-add'))
    fireEvent.change(within(channels).getByTestId('channel-email-0'), { target: { value: 'ap@fern.shop' } })
    fireEvent.click(within(channels).getByTestId('channel-email-add'))
    fireEvent.change(within(channels).getByTestId('channel-email-1'), { target: { value: 'owner@fern.shop' } })
    fireEvent.click(within(channels).getByTestId('channel-phone-add'))
    fireEvent.change(within(channels).getByTestId('channel-phone-0'), { target: { value: '5035550182' } })

    // Remove the second extra email.
    fireEvent.click(within(channels).getByTestId('channel-email-remove-1'))
    expect(within(channels).queryByTestId('channel-email-1')).toBeNull()
    expect(within(channels).getByTestId('channel-email-0')).toHaveValue('ap@fern.shop')
  })

  it('the extras land on the primary contact answer (primary scalar separate)', () => {
    const q = findQuestion('contact', 'main-contact')!
    const applied = q.apply({ engagementType: 'bookkeeping' } as WizardAnswers, {
      contactName: 'Wren Okafor',
      contactEmail: 'wren@fern.shop',
      contactPhone: '',
      contactEmailsExtra: ['ap@fern.shop', '  ', 'owner@fern.shop'],
      contactPhonesExtra: ['(503) 555-0182'],
    }) as WizardAnswers
    const primary = (applied.contacts ?? []).find((c) => c.isPrimary)!
    expect(primary.email).toBe('wren@fern.shop')
    expect(primary.emails).toEqual(['ap@fern.shop', 'owner@fern.shop'])
    expect(primary.phones).toEqual(['5035550182'])
    // And the fields read them back for editing.
    const value = q.fieldsValue!(applied) as Record<string, unknown>
    expect(value.contactEmailsExtra).toEqual(['ap@fern.shop', 'owner@fern.shop'])
    expect(value.contactPhonesExtra).toEqual(['5035550182'])
  })
})

describe('M5/E2: balance_boxes_gaap_order (10_10 00:39:19)', () => {
  const answers = {
    legalName: 'GAAP Co',
    engagementType: 'bookkeeping',
    checkingAccounts: [
      { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
    ],
    creditCardAccounts: [
      { name: 'Amex Credit card · 1005', accountType: 'credit_card', proofCategory: 'statement', institution: 'Amex', last4: '1005' },
    ],
    vehicleAssets: [
      { name: '2022 Ford Transit van', accountType: 'vehicle', proofCategory: 'bill_of_sale', year: 2022, financed: 'financed' },
    ],
    loanAccounts: [
      { name: 'Delivery van loan', accountType: 'loan', proofCategory: 'statement', lender: 'Ford Credit' },
    ],
    owners: [{ name: 'Wren Okafor' }, { name: 'Daniel Reyes' }],
    equitySetup: 'breakdown',
    equityBreakdown: ['contributions', 'distributions'],
    equityPerOwner: true,
  } as unknown as WizardAnswers

  function renderReview(a: WizardAnswers) {
    return render(
      <ReviewScreen
        intakeId={1}
        answers={a}
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

  it('credit cards are a CURRENT LIABILITY; loans are long-term', () => {
    renderReview(answers)
    const currentLiabilities = screen.getByTestId('balance-box-liabilities-current')
    expect(within(currentLiabilities).getByText('Amex Credit card · 1005')).toBeInTheDocument()
    const longTermLiabilities = screen.getByTestId('balance-box-liabilities-long-term')
    expect(within(longTermLiabilities).getByText('Delivery van loan')).toBeInTheDocument()
    // The credit card is NOT in the Assets box anymore.
    const assetsBox = screen.getByTestId('balance-box-assets')
    expect(within(assetsBox).queryByText(/Amex/)).toBeNull()
    // Assets keep their current/long-term split.
    expect(within(screen.getByTestId('balance-box-assets-current')).getByText('Chase Checking · 4411')).toBeInTheDocument()
    expect(within(screen.getByTestId('balance-box-assets-long-term')).getByText('2022 Ford Transit van')).toBeInTheDocument()
  })

  it('the boxes run assets -> liabilities -> equity (GAAP)', () => {
    renderReview(answers)
    const boxes = screen.getAllByTestId(/^balance-box-(assets|liabilities|equity)$/)
    expect(boxes.map((b) => b.getAttribute('data-testid'))).toEqual([
      'balance-box-assets',
      'balance-box-liabilities',
      'balance-box-equity',
    ])
  })
})
