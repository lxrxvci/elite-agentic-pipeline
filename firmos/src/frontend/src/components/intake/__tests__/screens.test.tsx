import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import type { ContactLookupResults } from '@/server/contact-lookup'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { PayrollProviderRow } from '@/server/payroll-providers'

import { dateTextDigits, dateTextLabel, dateTextToIso, isoToDateText, maskDateText } from '../date-text'
import { formatPhone, phoneDigits } from '../format'
import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * I1 interaction units: the masked date-text field, phone auto-formatting,
 * the "Other - type it" card on selects, and the owner prefill buttons on
 * the contacts repeatable. Rendered against the real registry questions.
 */

function Harness({
  q,
  initial,
  onAdvance,
  contactSearch,
  payrollProviders,
  onAddPayrollProvider,
  merchantProcessors,
  onAddMerchantProcessor,
}: {
  q: QuestionDef
  initial: WizardAnswers
  onAdvance?: () => void
  /** J1: picker/list data - the wizard's server actions, stubbed here. */
  contactSearch?: (query: string) => Promise<ContactLookupResults | null>
  payrollProviders?: PayrollProviderRow[]
  onAddPayrollProvider?: (name: string) => Promise<PayrollProviderRow | null>
  merchantProcessors?: MerchantProcessorRow[]
  onAddMerchantProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={(v) => setAnswers((a) => ({ ...a, ...q.apply(a, v) }))}
        contactSearch={contactSearch}
        payrollProviders={payrollProviders}
        onAddPayrollProvider={onAddPayrollProvider}
        merchantProcessors={merchantProcessors}
        onAddMerchantProcessor={onAddMerchantProcessor}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('date-text field (I1, 00:33:00)', () => {
  it('masks digits into MM/DD/YYYY while typing', () => {
    expect(maskDateText('01052026')).toBe('01/05/2026')
    expect(maskDateText('1')).toBe('1')
    expect(maskDateText('121')).toBe('12/1')
    expect(maskDateText('12/05/2026')).toBe('12/05/2026')
    expect(dateTextDigits('(12) ab-05/2026!!')).toBe('12052026')
  })

  it('parses only real dates', () => {
    expect(dateTextToIso('01/05/2026')).toBe('2026-01-05')
    expect(dateTextToIso('02/29/2024')).toBe('2024-02-29') // leap day
    expect(dateTextToIso('02/29/2026')).toBeNull() // not a leap year
    expect(dateTextToIso('13/45/2026')).toBeNull() // impossible month and day
    expect(dateTextToIso('00/10/2026')).toBeNull()
    expect(dateTextToIso('12/31/1800')).toBeNull() // out of range
    expect(dateTextToIso('01/05/26')).toBeNull() // incomplete
    expect(dateTextToIso('')).toBeNull()
  })

  it('round-trips ISO display and labels the review row', () => {
    expect(isoToDateText('2026-01-05')).toBe('01/05/2026')
    expect(isoToDateText(null)).toBe('')
    expect(dateTextLabel('2026-01-05')).toBe('Jan 5, 2026')
    expect(dateTextLabel('garbage')).toBeNull()
  })

  it('rejects 13/45/2026: nothing commits, the inline alert shows, Continue blocks', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('starting', 'bk-start')!} initial={{ engagementType: 'bookkeeping' }} onAdvance={onAdvance} />)
    const input = screen.getByLabelText('So your books should start:')
    fireEvent.change(input, { target: { value: '13/45/2026' } })
    expect(input).toHaveValue('13/45/2026')
    expect(screen.getByRole('alert')).toHaveTextContent("That date isn't real")
    expect(answersNow().bookkeepingStartDate ?? null).toBeNull()

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByText("That date isn't real - use MM/DD/YYYY.")).toBeInTheDocument()
    expect(screen.getByText('So your books should start: is required.')).toBeInTheDocument()
  })

  it('commits a valid typed date as ISO on the stable answer key', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('starting', 'bk-start')!} initial={{ engagementType: 'bookkeeping' }} onAdvance={onAdvance} />)
    const input = screen.getByLabelText('So your books should start:')
    fireEvent.change(input, { target: { value: '01052026' } })
    expect(input).toHaveValue('01/05/2026')
    expect(answersNow().bookkeepingStartDate).toBe('2026-01-05')

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('renders an existing ISO answer as masked text', () => {
    render(
      <Harness
        q={findQuestion('starting', 'bk-start')!}
        initial={{ engagementType: 'bookkeeping', bookkeepingStartDate: '2026-01-05' }}
      />,
    )
    expect(screen.getByLabelText('So your books should start:')).toHaveValue('01/05/2026')
  })
})

describe('phone auto-format (I1, 00:30:14)', () => {
  it('formats progressively and stores digits only', () => {
    expect(formatPhone('5')).toBe('(5')
    expect(formatPhone('503')).toBe('(503')
    expect(formatPhone('5035')).toBe('(503) 5')
    expect(formatPhone('5035550')).toBe('(503) 555-0')
    expect(formatPhone('5035550182')).toBe('(503) 555-0182')
    expect(formatPhone('15035550182')).toBe('+1 (503) 555-0182')
    expect(phoneDigits('(503) 555-0182')).toBe('5035550182')
    expect(phoneDigits(null)).toBe('')
  })

  it('the main-contact phone field masks while typing and commits digits', () => {
    render(<Harness q={findQuestion('contact', 'main-contact')!} initial={{ legalName: 'Test Co' }} />)
    const phone = screen.getByLabelText('Phone')
    fireEvent.change(phone, { target: { value: '5035550182' } })
    expect(phone).toHaveValue('(503) 555-0182')
    expect(answersNow().contacts?.[0]?.phone).toBe('5035550182')
  })
})

describe('"Other - type it" on carded selects (I1, 00:15:53)', () => {
  it('appends the Other card on multi-option selects and opens the inline input when picked', () => {
    render(<Harness q={findQuestion('engagement', 'engagement')!} initial={{}} />)
    const other = screen.getByTestId('option-Other')
    expect(other).toHaveTextContent('Other — type it')
    fireEvent.click(other)
    const input = screen.getByTestId('custom-input-engagement')
    fireEvent.change(input, { target: { value: 'Fractional CFO retainer' } })
    const a = answersNow()
    expect(a.engagementType).toBe('Other')
    expect(a.customAnswers).toEqual({ engagement: 'Fractional CFO retainer' })
    // A Continue button appears since auto-advance is suppressed on Other.
    expect(screen.getByTestId('continue')).toBeInTheDocument()
  })

  it('reuses the existing Other option card when the question already has one', () => {
    render(<Harness q={findQuestion('entity', 'tax-structure')!} initial={{}} />)
    expect(screen.getAllByTestId('option-Other')).toHaveLength(1)
    expect(screen.getByTestId('option-Other')).toHaveTextContent('Other / not sure')
  })

  it('never adds Other to yes/no cards', () => {
    render(<Harness q={findQuestion('entity', 'has-cpa')!} initial={{}} />)
    expect(screen.queryByTestId('option-Other')).toBeNull()
  })
})

describe('contacts owner prefill (I1, 00:29:05)', () => {
  it('fills the draft from the tapped owner', () => {
    render(
      <Harness
        q={findQuestion('entity', 'contacts')!}
        initial={{ owners: [{ name: 'Wren Okafor', email: 'wren@fernfeather.shop', phone: '5035550182' }] }}
      />,
    )
    const prefill = screen.getByTestId('prefill-0')
    expect(prefill).toHaveTextContent('Same as Wren Okafor')
    fireEvent.click(prefill)
    expect(screen.getByLabelText('First name')).toHaveValue('Wren')
    expect(screen.getByLabelText('Last name')).toHaveValue('Okafor')
    expect(screen.getByLabelText('Email')).toHaveValue('wren@fernfeather.shop')
    expect(screen.getByLabelText('Phone')).toHaveValue('(503) 555-0182')

    fireEvent.click(screen.getByTestId('add-another'))
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
  })

  it('offers no prefill buttons when there are no owners', () => {
    render(<Harness q={findQuestion('entity', 'contacts')!} initial={{}} />)
    expect(screen.queryByTestId('prefill-0')).toBeNull()
  })
})


describe('owner-count guards on the owners screen (I2, 00:26:10)', () => {
  const ownersQ = findQuestion('entity', 'owners')!

  it('sole prop: Continue with no owners blocks with the plain-language message', () => {
    const onAdvance = vi.fn()
    render(
      <Harness q={ownersQ} initial={{ taxStructure: 'Sole proprietorship' }} onAdvance={onAdvance} />,
    )
    // An unskippable minimum: the button reads Continue, not "Skip for now".
    expect(screen.getByTestId('continue')).toHaveTextContent('Continue')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('A sole proprietorship has exactly one owner.')
  })

  it('sole prop: one owner in, the add form swaps for the cap note', () => {
    const onAdvance = vi.fn()
    render(
      <Harness q={ownersQ} initial={{ taxStructure: 'Sole proprietorship' }} onAdvance={onAdvance} />,
    )
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Wren Okafor' } })
    fireEvent.click(screen.getByTestId('add-another'))
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
    // Capped at 1: the draft form is gone, replaced by the note.
    expect(screen.getByTestId('cap-note')).toHaveTextContent('One owner is the cap for a sole proprietorship.')
    expect(screen.queryByTestId('add-another')).toBeNull()
    expect(screen.queryByLabelText('Full name')).toBeNull()

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('single-member LLC caps at one owner the same way', () => {
    render(
      <Harness
        q={ownersQ}
        initial={{ taxStructure: 'LLC', llcSubclass: 'llc_sml', owners: [{ name: 'Wren Okafor' }] }}
      />,
    )
    expect(screen.getByTestId('cap-note')).toHaveTextContent('One owner is the cap for a single-member LLC.')
    expect(screen.queryByTestId('add-another')).toBeNull()
  })

  it('partnership_requires_two_owners: one owner blocks, two pass', () => {
    const onAdvance = vi.fn()
    render(
      <Harness
        q={ownersQ}
        initial={{ taxStructure: 'LLC', llcSubclass: 'llc_partnership', owners: [{ name: 'Wren Okafor' }] }}
        onAdvance={onAdvance}
      />,
    )
    // One listed owner, empty draft: Continue blocks with the message.
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('A partnership needs at least 2 owners.')

    // Add the second owner and Continue sails through.
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sal Vega' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
    expect(answersNow().owners).toHaveLength(2)
  })

  it('partnership is uncapped: a third owner still fits', () => {
    render(
      <Harness
        q={ownersQ}
        initial={{
          taxStructure: 'Partnership',
          owners: [{ name: 'Wren Okafor' }, { name: 'Sal Vega' }],
        }}
      />,
    )
    expect(screen.queryByTestId('cap-note')).toBeNull()
    expect(screen.getByTestId('add-another')).toBeInTheDocument()
  })
})

describe('corporate payroll card (I2, 00:48:07)', () => {
  it('an S corp pre-selects Yes and locks the No card', () => {
    render(<Harness q={findQuestion('income', 'payroll')!} initial={{ taxStructure: 'S-corp' }} />)
    expect(screen.getByTestId('option-yes')).toHaveAttribute('data-selected', 'true')
    const no = screen.getByTestId('option-no')
    expect(no).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(no)
    // The locked card never applies: still Yes, still unanswered-stored.
    expect(answersNow().hasPayroll ?? null).toBeNull()
  })

  it('a pre-answered select still offers Continue (no dead end)', () => {
    // Live-verified 2026-09: with Yes pre-selected and No locked, the screen
    // rendered no affordance at all and the wizard stalled here.
    const onAdvance = vi.fn()
    render(
      <Harness q={findQuestion('income', 'payroll')!} initial={{ taxStructure: 'S-corp' }} onAdvance={onAdvance} />,
    )
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('an unanswered select keeps the auto-advance-only flow (no Continue)', () => {
    render(<Harness q={findQuestion('income', 'personal-card')!} initial={{}} />)
    expect(screen.queryByTestId('continue')).toBeNull()
  })

  it('a sole prop gets the owner-never-on-payroll nuance and a live No card', () => {
    render(<Harness q={findQuestion('income', 'payroll')!} initial={{ taxStructure: 'Sole proprietorship' }} />)
    const no = screen.getByTestId('option-no')
    expect(no).not.toHaveAttribute('aria-disabled')
    fireEvent.click(no)
    expect(answersNow().hasPayroll).toBe(false)
  })
})

describe('I4 services screen (plan §1 screen 5, §3C)', () => {
  const servicesQ = findQuestion('services', 'services')!

  it('renders the three standards as a pre-selected, un-unselectable group', () => {
    render(<Harness q={servicesQ} initial={{}} />)
    const group = screen.getByTestId('services-standards')
    expect(group).toHaveTextContent('Included in every engagement')
    // The three standards, all checked: bank feed, reconciliation, reporting.
    expect(screen.getByTestId('standard-bank_feed_management')).toHaveAttribute('data-checked', 'true')
    expect(screen.getByTestId('standard-account_reconciliations')).toHaveAttribute('data-checked', 'true')
    expect(screen.getByTestId('standard-reporting')).toHaveAttribute('data-checked', 'true')
    // Standards are not buttons - there is nothing to unselect.
    expect(screen.queryByTestId('addon-bank_feed_management')).toBeNull()
    expect(screen.queryByRole('button', { name: /bank feed management/i })).toBeNull()
  })

  it('toggling add-ons writes the standards plus the picks on the stable key', () => {
    const onAdvance = vi.fn()
    render(<Harness q={servicesQ} initial={{}} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('addon-invoicing'))
    fireEvent.click(screen.getByTestId('addon-class_tracking'))
    expect(answersNow().serviceKeys).toEqual(
      expect.arrayContaining(['bank_feed_management', 'account_reconciliations', 'invoicing', 'class_tracking']),
    )
    fireEvent.click(screen.getByTestId('addon-class_tracking')) // off again
    expect(answersNow().serviceKeys).toEqual(
      expect.arrayContaining(['bank_feed_management', 'account_reconciliations', 'invoicing']),
    )
    expect(answersNow().serviceKeys).not.toContain('class_tracking')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('Continue with no add-ons still commits the standards', () => {
    const onAdvance = vi.fn()
    render(<Harness q={servicesQ} initial={{}} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
    expect(answersNow().serviceKeys).toEqual(['bank_feed_management', 'account_reconciliations'])
  })

  it('legacy stored selections reconcile into the add-on toggles', () => {
    render(
      <Harness
        q={servicesQ}
        initial={{ serviceKeys: ['loans_and_liabilities', 'bank_feed_management', 'invoicing'] }}
      />,
    )
    // The legacy loans key has no row, but survives the next write.
    fireEvent.click(screen.getByTestId('addon-payment_processing'))
    expect(answersNow().serviceKeys).toEqual(
      expect.arrayContaining(['loans_and_liabilities', 'invoicing', 'payment_processing']),
    )
    // The stored add-on reads as toggled on.
    expect(screen.getByTestId('addon-invoicing')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('addon-payment_processing')).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists the rule-1 add-ons that their own questions quote', () => {
    render(<Harness q={servicesQ} initial={{}} />)
    const later = screen.getByTestId('services-later-addons')
    for (const value of ['payroll', 'record_bills', '1099_collection', 'specialty_reports', 'merchant_account_reconciliation']) {
      expect(screen.getByTestId(`later-${value}`)).toBeInTheDocument()
    }
    expect(later).toHaveTextContent('Quoted in their own questions')
  })
})

// ── I3 account count cards (plan §1 screen 7) ─────────────────────────────

const BANKS = [
  { id: 7, name: 'Chase' },
  { id: 3, name: 'Columbia' },
]

function AccountsHarness({
  q,
  initial,
  onAdvance,
  onAddInstitution,
}: {
  q: QuestionDef
  initial: WizardAnswers
  onAdvance?: () => void
  onAddInstitution?: (name: string) => Promise<{ id: number; name: string } | null>
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  const [institutions, setInstitutions] = useState(BANKS)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={() => {}}
        institutions={institutions}
        onAddInstitution={async (name) => {
          const row = (await onAddInstitution?.(name)) ?? { id: 99, name }
          setInstitutions((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]))
          return row
        }}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

describe('I3 account count cards (plan §1 screen 7)', () => {
  const checking = findQuestion('balance', 'checking-accounts')!

  it('the count generates that many mini-forms, pre-stamped with locked statement proof', () => {
    render(<AccountsHarness q={checking} initial={{}} />)
    expect(screen.queryByTestId('account-form-0')).toBeNull()
    fireEvent.change(screen.getByTestId('count-input'), { target: { value: '2' } })
    expect(screen.getByTestId('account-form-0')).toBeInTheDocument()
    expect(screen.getByTestId('account-form-1')).toBeInTheDocument()
    expect(screen.queryByTestId('account-form-2')).toBeNull()
    const committed = answersNow().checkingAccounts ?? []
    expect(committed).toHaveLength(2)
    expect(committed[0]).toMatchObject({ accountType: 'checking', proofCategory: 'statement' })
    // Lowering the count truncates from the end.
    fireEvent.change(screen.getByTestId('count-input'), { target: { value: '1' } })
    expect(screen.queryByTestId('account-form-1')).toBeNull()
  })

  it('bank pick + last-4 + the login-access checkbox commit per mini-form (the name derives - no nickname field, J1/D1)', () => {
    render(<AccountsHarness q={checking} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    // D1: the nickname field is gone.
    expect(screen.queryByLabelText(/nickname/i)).toBeNull()
    fireEvent.click(screen.getByTestId('bank-select-0'))
    fireEvent.click(screen.getByTestId('bank-option-7'))
    fireEvent.change(screen.getByTestId('last4-0'), { target: { value: '4411' } })
    fireEvent.click(screen.getByTestId('grant-access-0'))
    const committed = answersNow().checkingAccounts ?? []
    expect(committed[0]).toMatchObject({
      // D2: the derived label IS the account name.
      name: 'Chase Checking · 4411',
      institutionId: 7,
      institution: 'Chase',
      last4: '4411',
      grantLoginAccess: true,
    })
    // The mini-form header shows the derived label.
    expect(screen.getByTestId('account-label-0')).toHaveTextContent('Chase Checking · 4411')
  })

  it('add a new bank persists through the handler and appears in the same session dropdown', async () => {
    const onAddInstitution = vi.fn(async (name: string) => ({ id: 42, name }))
    render(<AccountsHarness q={checking} initial={{}} onAddInstitution={onAddInstitution} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    fireEvent.click(screen.getByTestId('bank-select-0'))
    fireEvent.click(screen.getByTestId('bank-add-toggle-0'))
    fireEvent.change(screen.getByTestId('bank-add-input'), { target: { value: 'Umpqua' } })
    fireEvent.click(screen.getByTestId('bank-add-submit'))
    // The add round-trips through the (async) server action first.
    await waitFor(() => expect(onAddInstitution).toHaveBeenCalledWith('Umpqua'))
    // The new bank is selected on the mini-form...
    await waitFor(() =>
      expect((answersNow().checkingAccounts ?? [])[0]).toMatchObject({
        institutionId: 42,
        institution: 'Umpqua',
      }),
    )
    // ...and listed in the dropdown for the next account in this session.
    fireEvent.click(screen.getByTestId('bank-select-0'))
    expect(await screen.findByTestId('bank-option-42')).toHaveTextContent('Umpqua')
  })

  it('Continue blocks until every generated form has its bank + last-4 (J1/D1)', () => {
    const onAdvance = vi.fn()
    render(<AccountsHarness q={checking} initial={{}} onAdvance={onAdvance} />)
    fireEvent.change(screen.getByTestId('count-input'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('bank-select-0'))
    fireEvent.click(screen.getByTestId('bank-option-7'))
    fireEvent.change(screen.getByTestId('last4-0'), { target: { value: '4411' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Pick the bank for account #2.')
    fireEvent.click(screen.getByTestId('bank-select-1'))
    fireEvent.click(screen.getByTestId('bank-option-3'))
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the last 4 digits for account #2 - exactly 4 numbers.')
    fireEvent.change(screen.getByTestId('last4-1'), { target: { value: '0099' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('the last-4 input is digits-only and rejects 3 or 5 digits (J1/D1)', () => {
    render(<AccountsHarness q={checking} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    const input = screen.getByTestId('last4-0')
    // Letters strip out; the field caps at 4 digits.
    fireEvent.change(input, { target: { value: 'ab44117' } })
    expect(input).toHaveValue('4411')
    expect((answersNow().checkingAccounts ?? [])[0]?.last4).toBe('4411')
    // Three digits: committed but flagged invalid inline.
    fireEvent.change(input, { target: { value: '441' } })
    expect(input).toHaveValue('441')
    expect(screen.getByRole('alert')).toHaveTextContent('Exactly 4 digits')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('money accounts show the locked proof note instead of a selector', () => {
    render(<AccountsHarness q={checking} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    expect(screen.getByTestId('proof-locked-0')).toHaveTextContent('Proof: bank statement')
    expect(screen.queryByTestId('proof-select-0')).toBeNull()
  })

  it('vehicles ask description, year, financed/paid-in-full, and bill-of-sale proof - no value, never an institution (J1/D3/D5)', () => {
    const vehicles = findQuestion('balance', 'vehicles')!
    render(<AccountsHarness q={vehicles} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    expect(screen.queryByTestId('bank-select-0')).toBeNull()
    expect(screen.getByLabelText('Vehicle year 1')).toBeInTheDocument()
    // D3: the value estimate is gone.
    expect(screen.queryByLabelText('Vehicle value 1')).toBeNull()
    // D5: the financed pick is required.
    expect(screen.getByTestId('financed-select-0')).toBeInTheDocument()
    const proof = screen.getByTestId('proof-select-0') as HTMLSelectElement
    expect(proof.value).toBe('bill_of_sale')
    expect([...proof.options].map((o) => o.value)).toEqual(['bill_of_sale', 'owner_declared'])
    fireEvent.change(screen.getByLabelText('Description 1'), { target: { value: '2022 Ford Transit' } })
    const committed = answersNow().vehicleAssets ?? []
    expect(committed[0]).toMatchObject({ name: '2022 Ford Transit', accountType: 'vehicle' })
  })

  it('vehicles block Continue until the financed pick is made (D5)', () => {
    const onAdvance = vi.fn()
    render(<AccountsHarness q={findQuestion('balance', 'vehicles')!} initial={{}} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    fireEvent.change(screen.getByLabelText('Description 1'), { target: { value: 'Toyota Tundra' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Is Toyota Tundra financed or paid in full?')
    fireEvent.change(screen.getByTestId('financed-select-0'), { target: { value: 'financed' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('loans carry a lender + proof - no balance (J1/D3); the lender is a bank dropdown on statement proof, a write-in on owner-declared (D6)', () => {
    const loans = findQuestion('balance', 'loans')!
    render(<AccountsHarness q={loans} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    expect(screen.queryByTestId('bank-select-0')).toBeNull()
    // D3: no balance field anywhere on the card.
    expect(screen.queryByLabelText(/balance/i)).toBeNull()
    const proof = screen.getByTestId('proof-select-0') as HTMLSelectElement
    expect(proof.value).toBe('statement')
    // Statement proof: the lender is the institutions dropdown.
    expect(screen.getByTestId('lender-select-0')).toBeInTheDocument()
    expect(screen.queryByTestId('lender-writein-0')).toBeNull()
    fireEvent.change(screen.getByLabelText('Loan name 1'), { target: { value: 'Van loan' } })
    fireEvent.click(screen.getByTestId('lender-select-0'))
    fireEvent.click(screen.getByTestId('lender-option-7'))
    let committed = answersNow().loanAccounts ?? []
    expect(committed[0]).toMatchObject({
      name: 'Van loan',
      lender: 'Chase',
      lenderInstitutionId: 7,
      proofCategory: 'statement',
    })
    // Owner-declared: the dropdown swaps for a free-text write-in and the
    // institution link clears - the write-in never touches the bank list.
    fireEvent.change(proof, { target: { value: 'owner_declared' } })
    expect(screen.queryByTestId('lender-select-0')).toBeNull()
    fireEvent.change(screen.getByLabelText('Lender 1'), { target: { value: 'Wren' } })
    committed = answersNow().loanAccounts ?? []
    expect(committed[0]).toMatchObject({
      name: 'Van loan',
      lender: 'Wren',
      lenderInstitutionId: null,
      proofCategory: 'owner_declared',
    })
  })

  it('other assets carry the typed bucket and a proof pick', () => {
    const other = findQuestion('balance', 'other-assets')!
    render(<AccountsHarness q={other} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    fireEvent.change(screen.getByTestId('asset-type-0'), { target: { value: 'goodwill' } })
    const committed = answersNow().otherAssets ?? []
    expect(committed[0]).toMatchObject({ assetType: 'goodwill', proofCategory: 'owner_declared' })
  })
})

describe('I3 online-access checklist (plan §1 screen 10)', () => {
  const q = findQuestion('access', 'online-access')!
  const withAccounts: WizardAnswers = {
    checkingAccounts: [
      { name: 'Operating', accountType: 'checking', proofCategory: 'statement', institution: 'Chase' },
      { name: 'Payroll', accountType: 'checking', proofCategory: 'statement', institution: 'Columbia' },
    ],
    vehicleAssets: [{ name: 'Transit', accountType: 'vehicle', proofCategory: 'bill_of_sale' }],
  }

  it('renders the statement-proof accounts as checklist cards and checks set the flag', () => {
    render(<Harness q={q} initial={withAccounts} />)
    const operating = screen.getByTestId('check-checkingAccounts:0')
    expect(operating).toHaveTextContent('Operating')
    expect(operating).toHaveTextContent('Checking · Chase')
    expect(screen.getByTestId('check-checkingAccounts:1')).toHaveTextContent('Payroll')
    // The bill-of-sale vehicle never appears.
    expect(screen.queryByText('Transit')).toBeNull()
    fireEvent.click(operating)
    expect(operating).toHaveAttribute('aria-checked', 'true')
    const committed = answersNow().checkingAccounts ?? []
    expect(committed[0]?.grantLoginAccess).toBe(true)
    expect(committed[1]?.grantLoginAccess).toBe(false)
  })

  it('a mini-form-checked account starts checked on the checklist', () => {
    render(
      <Harness
        q={q}
        initial={{
          ...withAccounts,
          checkingAccounts: [{ ...withAccounts.checkingAccounts![0], grantLoginAccess: true }],
        }}
      />,
    )
    expect(screen.getByTestId('check-checkingAccounts:0')).toHaveAttribute('aria-checked', 'true')
  })
})

// ── J1 (meeting #3): contact dedup UI, database dropdowns, merchant flag ──

const WREN_HIT: ContactLookupResults = {
  contacts: [
    {
      kind: 'contact',
      id: 55,
      name: 'Wren Okafor',
      firstName: 'Wren',
      lastName: 'Okafor',
      entityName: null,
      email: 'wren@existing.example',
      phone: '5035550182',
    },
  ],
  clients: [],
}

const CPA_HIT: ContactLookupResults = {
  contacts: [
    {
      kind: 'contact',
      id: 56,
      name: 'Cascade Tax Group',
      firstName: null,
      lastName: null,
      entityName: 'Cascade Tax Group',
      email: 'team@cascadetax.example',
      phone: null,
    },
  ],
  clients: [],
}

describe('contact_picker_never_duplicates_a_person - UI half (J1, C5)', () => {
  it('picking an existing contact commits a LINKED item straight onto the contacts list', async () => {
    const search = vi.fn(async () => WREN_HIT)
    render(<Harness q={findQuestion('entity', 'contacts')!} initial={{}} contactSearch={search} />)
    const input = screen.getByTestId('contact-picker-input')
    fireEvent.change(input, { target: { value: 'wren' } })
    const option = await screen.findByTestId('contact-picker-option-contact-55', undefined, { timeout: 2000 })
    expect(option).toHaveTextContent('Wren Okafor')
    fireEvent.click(option)
    // Linked item: contactId set, snapshot fields filled, no draft involved.
    const committed = answersNow().contacts ?? []
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({
      contactId: 55,
      firstName: 'Wren',
      lastName: 'Okafor',
      email: 'wren@existing.example',
    })
    expect(screen.getByTestId('entity-chip')).toHaveTextContent('Wren Okafor')
    expect(screen.getByTestId('entity-chip')).toHaveTextContent('linked from the existing record')
    // The draft form stayed empty - nothing new was created.
    expect(screen.getByLabelText('First name')).toHaveValue('')
  })

  it('an already-linked contact is excluded from further results', async () => {
    const search = vi.fn(async () => WREN_HIT)
    render(
      <Harness
        q={findQuestion('entity', 'contacts')!}
        initial={{ contacts: [{ contactId: 55, firstName: 'Wren', lastName: 'Okafor' }] }}
        contactSearch={search}
      />,
    )
    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'wren' } })
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 })
    await screen.findByTestId('contact-picker-empty', undefined, { timeout: 2000 })
    expect(screen.queryByTestId('contact-picker-option-contact-55')).toBeNull()
  })
})

describe('CPA card is picker-first (J1, C6)', () => {
  it('picking an existing CPA writes the link and shows the badge; typing over the name clears it', async () => {
    const search = vi.fn(async () => CPA_HIT)
    render(
      <Harness q={findQuestion('entity', 'cpa-details')!} initial={{ hasCpa: true }} contactSearch={search} />,
    )
    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'cascade' } })
    const option = await screen.findByTestId('contact-picker-option-contact-56', undefined, { timeout: 2000 })
    fireEvent.click(option)
    let a = answersNow()
    expect(a.cpaName).toBe('Cascade Tax Group')
    expect(a.cpaEmail).toBe('team@cascadetax.example')
    expect(a.cpaContactId).toBe(56)
    expect(screen.getByTestId('picker-linked-badge')).toBeInTheDocument()
    // Typing over the name drops the link (the create-new path).
    fireEvent.change(screen.getByLabelText('CPA name or firm'), { target: { value: 'Cascade Tax Group LLC' } })
    a = answersNow()
    expect(a.cpaName).toBe('Cascade Tax Group LLC')
    expect(a.cpaContactId).toBeNull()
    expect(screen.queryByTestId('picker-linked-badge')).toBeNull()
  })

  it('the create-new option types a fresh CPA name without a link', async () => {
    const search = vi.fn(async () => ({ contacts: [], clients: [] }))
    render(
      <Harness q={findQuestion('entity', 'cpa-details')!} initial={{ hasCpa: true }} contactSearch={search} />,
    )
    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'Yes Taxes' } })
    const create = await screen.findByTestId('contact-picker-create', undefined, { timeout: 2000 })
    fireEvent.click(create)
    expect(answersNow().cpaName).toBe('Yes Taxes')
    expect(answersNow().cpaContactId).toBeNull()
    expect(screen.getByLabelText('CPA name or firm')).toHaveValue('Yes Taxes')
  })
})

describe('referral-who picker pulls contacts AND clients (J1, C7)', () => {
  it('picking a client writes the name plus the client link', async () => {
    const search = vi.fn(async () => ({
      contacts: [],
      clients: [{ kind: 'client' as const, id: 77, name: 'Harborline Marine Supply' }],
    }))
    render(
      <Harness
        q={findQuestion('entity', 'referral-who')!}
        initial={{ referralSource: 'Existing client' }}
        contactSearch={search}
      />,
    )
    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'harbor' } })
    const option = await screen.findByTestId('contact-picker-option-client-77', undefined, { timeout: 2000 })
    fireEvent.click(option)
    const a = answersNow()
    expect(a.referralWho).toBe('Harborline Marine Supply')
    expect(a.referralClientId).toBe(77)
    expect(a.referralContactId).toBeNull()
  })
})

describe('payroll provider database dropdown (J1, P2/DB1)', () => {
  const PROVIDERS: PayrollProviderRow[] = [
    { id: 1, name: 'ADP' },
    { id: 2, name: 'Gusto' },
  ]

  it('picks from the database list and stores the provider NAME on the stable key', () => {
    const onAdvance = vi.fn()
    render(
      <Harness
        q={findQuestion('income', 'payroll-provider')!}
        initial={{ hasPayroll: true }}
        payrollProviders={PROVIDERS}
        onAdvance={onAdvance}
      />,
    )
    fireEvent.click(screen.getByTestId('provider-select-0'))
    fireEvent.click(screen.getByTestId('provider-option-2'))
    expect(answersNow().payrollProvider).toBe('Gusto')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('add-new persists through the handler and selects the new provider in the same session', async () => {
    const onAdd = vi.fn(async (name: string) => ({ id: 42, name }))
    function ProvidersHarness() {
      const [rows, setRows] = useState(PROVIDERS)
      return (
        <Harness
          q={findQuestion('income', 'payroll-provider')!}
          initial={{ hasPayroll: true }}
          payrollProviders={rows}
          onAddPayrollProvider={async (name) => {
            const row = await onAdd(name)
            setRows((prev) => [...prev, row])
            return row
          }}
        />
      )
    }
    render(<ProvidersHarness />)
    fireEvent.click(screen.getByTestId('provider-select-0'))
    fireEvent.click(screen.getByTestId('provider-add-toggle-0'))
    fireEvent.change(screen.getByTestId('provider-add-input'), { target: { value: 'SurePayroll' } })
    fireEvent.click(screen.getByTestId('provider-add-submit'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('SurePayroll'))
    // Selected immediately, on the stable answer key...
    await waitFor(() => expect(answersNow().payrollProvider).toBe('SurePayroll'))
    // ...and listed for the next pick in this session.
    fireEvent.click(screen.getByTestId('provider-select-0'))
    expect(await screen.findByTestId('provider-option-42')).toHaveTextContent('SurePayroll')
  })
})

describe('merchants processor dropdown + the E5 required flag (J1)', () => {
  const PROCESSORS: MerchantProcessorRow[] = [
    { id: 1, name: 'Square' },
    { id: 2, name: 'Stripe' },
  ]
  const merchantsQ = findQuestion('income', 'merchants')!

  it('the processor dropdown writes name + processorId and pre-fills the account name', () => {
    render(
      <Harness
        q={merchantsQ}
        initial={{ paymentMethods: ['card'] }}
        merchantProcessors={PROCESSORS}
      />,
    )
    fireEvent.click(screen.getByTestId('processor-select-0'))
    fireEvent.click(screen.getByTestId('processor-option-2'))
    // The draft picked up both the name snapshot and the FK, and the account
    // name pre-filled from the pick.
    fireEvent.click(screen.getByTestId('add-another'))
    expect(answersNow().merchantAccounts).toEqual([{ name: 'Stripe', processor: 'Stripe', processorId: 2 }])
  })

  it('E5: with card payments the question cannot be skipped empty', () => {
    const onAdvance = vi.fn()
    render(<Harness q={merchantsQ} initial={{ paymentMethods: ['online'] }} onAdvance={onAdvance} />)
    expect(screen.getByTestId('continue')).toHaveTextContent('Continue')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one, or go back.')
  })
})

describe('ownership_sum_never_exceeds_100 - UI half (J1, C3)', () => {
  const ownersQ = findQuestion('entity', 'owners')!
  const partnership: WizardAnswers = { taxStructure: 'Partnership' }

  it('105% blocks Continue with the plain-language error; backing off to 100% sails through', () => {
    const onAdvance = vi.fn()
    render(
      <Harness
        q={ownersQ}
        initial={{
          ...partnership,
          owners: [
            { name: 'Wren Okafor', ownershipPercent: 60 },
            { name: 'Sal Vega', ownershipPercent: 45 },
          ],
        }}
        onAdvance={onAdvance}
      />,
    )
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent("You're at 105% — ownership can't exceed 100%")
  })

  it('under 100% shows the soft note and never blocks', () => {
    const onAdvance = vi.fn()
    render(
      <Harness
        q={ownersQ}
        initial={{
          ...partnership,
          owners: [
            { name: 'Wren Okafor', ownershipPercent: 60 },
            { name: 'Sal Vega', ownershipPercent: 20 },
          ],
        }}
        onAdvance={onAdvance}
      />,
    )
    expect(screen.getByTestId('items-note')).toHaveTextContent("You're at 80% - the rest can stay unassigned")
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })
})

describe('owners "Same as the primary contact" shortcut (J1, C1)', () => {
  it('one tap pulls the main contact into the owner draft', () => {
    render(
      <Harness
        q={findQuestion('entity', 'owners')!}
        initial={{
          taxStructure: 'Partnership',
          contacts: [
            { firstName: 'Wren', lastName: 'Okafor', email: 'wren@x.example', phone: '5035550182', isPrimary: true },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('prefill-0'))
    expect(screen.getByLabelText('Full name')).toHaveValue('Wren Okafor')
    expect(screen.getByLabelText('Email (optional)')).toHaveValue('wren@x.example')
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('(503) 555-0182')
  })
})

describe('financed vehicle routes to the loans card - UI half (J1, D5)', () => {
  it('committing a financed vehicle lands the linked entry on loanAccounts via the question apply', () => {
    render(<AccountsHarness q={findQuestion('balance', 'vehicles')!} initial={{}} />)
    fireEvent.click(screen.getByTestId('count-plus'))
    fireEvent.change(screen.getByLabelText('Description 1'), { target: { value: 'Toyota Tundra' } })
    fireEvent.change(screen.getByTestId('financed-select-0'), { target: { value: 'financed' } })
    fireEvent.click(screen.getByTestId('continue'))
    const a = answersNow()
    expect(a.vehicleAssets?.[0]).toMatchObject({ name: 'Toyota Tundra', financed: 'financed' })
    expect(a.loanAccounts?.[0]).toMatchObject({
      name: 'Toyota Tundra (vehicle loan)',
      accountType: 'vehicle_loan',
      fromVehicle: 'Toyota Tundra',
    })
  })
})
