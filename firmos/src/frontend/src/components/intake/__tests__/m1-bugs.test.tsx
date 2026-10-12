import { describe, expect, it, vi } from 'vitest'

import {
  findQuestion,
  foldPaymentMethod,
  type WizardAnswers,
} from '../registry'

// The wizard mounts in the flow repro below - mirror wizard.test.tsx's
// server-action mock block so no db layer loads in jsdom.
vi.mock('@/server/actions/intake', () => ({
  saveIntake: vi.fn(async () => ({ ok: true as const, data: { intake: {}, cascaded: false } })),
  getQuote: vi.fn(async () => ({ ok: true as const, data: null })),
  checkDuplicates: vi.fn(async () => ({ ok: true as const, data: [] })),
  submitIntakeForReview: vi.fn(async () => ({ ok: true as const, data: {} })),
  acceptIntakeEstimate: vi.fn(async () => ({ ok: true as const, data: { status: 'accepted' } })),
  convertIntake: vi.fn(async () => ({ ok: true as const, data: { clientId: 1 } })),
  getConversionTaskPlan: vi.fn(async () => ({ ok: true as const, data: { items: [] } })),
}))
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true, data: { correspondenceId: 1, to: 'a@b.c' } })),
  previewIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true as const, data: { to: 'a@b.c', subject: 's', body: 'b' } })),
}))
vi.mock('@/server/actions/institutions', () => ({
  listInstitutionsAction: vi.fn(async () => ({
    ok: true as const,
    data: [
      { id: 1, name: 'Chase' },
      { id: 2, name: 'Columbia' },
    ],
  })),
  addInstitutionAction: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 99, name } })),
}))
vi.mock('@/server/actions/payroll-providers', () => ({
  listPayrollProvidersAction: vi.fn(async () => ({ ok: true as const, data: [] })),
  addPayrollProviderAction: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 98, name } })),
}))
vi.mock('@/server/actions/merchant-processors', () => ({
  listMerchantProcessorsAction: vi.fn(async () => ({ ok: true as const, data: [] })),
  addMerchantProcessorAction: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 97, name } })),
}))
vi.mock('@/server/actions/option-lists', () => ({
  listOptionValuesBulkAction: vi.fn(async () => ({ ok: true as const, data: {} })),
  addOptionValueAction: vi.fn(async (key: string, name: string) => ({
    ok: true as const,
    data: { id: 96, listKey: key, name, meta: null, isActive: true },
  })),
}))
vi.mock('@/server/actions/services-catalog', () => ({
  listServicesCatalogAction: vi.fn(async () => ({ ok: false as const, error: 'no catalog in tests' })),
}))
vi.mock('@/server/actions/industry-suggestions', () => ({
  listIndustrySuggestionsAction: vi.fn(async () => ({ ok: true as const, data: [] })),
}))
vi.mock('@/server/actions/contacts', () => ({
  searchContactsAction: vi.fn(async () => ({ ok: true as const, data: { contacts: [], clients: [] } })),
}))

/**
 * M1 (10_10): the on-camera intake bugs from Meeting #5. B1/B2: the
 * duplicate "credit / debit card" seed wrote a non-canonical value, and
 * picking it hid the merchants question - Jason diagnosed the chain on the
 * call ("it's some probably to do with how it duplicated the credit debit
 * card thing", 00:40:20).
 */

describe('M1/B2: card_pick_never_hides_merchants (10_10 00:40:20)', () => {
  const merchants = findQuestion('income', 'merchants')!
  const merchantRecon = findQuestion('income', 'merchant-recon')!
  const paymentMethods = findQuestion('income', 'payment-methods')!

  it('the fold maps keys and labels to canonical keys; customs pass through', () => {
    expect(foldPaymentMethod('card')).toBe('card')
    expect(foldPaymentMethod('Credit or debit cards')).toBe('card')
    expect(foldPaymentMethod('Credit / debit card')).toBe('card')
    expect(foldPaymentMethod('ACH / bank transfer')).toBe('ach')
    expect(foldPaymentMethod('ACH')).toBe('ach')
    expect(foldPaymentMethod('Checks')).toBe('check')
    expect(foldPaymentMethod('Check')).toBe('check')
    expect(foldPaymentMethod('Online payments')).toBe('online')
    expect(foldPaymentMethod('Zelle')).toBe('Zelle')
  })

  it('the question stores canonical values at apply time', () => {
    const patch = paymentMethods.apply(
      {} as WizardAnswers,
      ['Credit / debit card', 'Check', 'Zelle'],
    ) as { paymentMethods: string[] }
    expect(patch.paymentMethods).toEqual(['card', 'check', 'Zelle'])
  })

  it('a stored duplicate variant still qualifies the merchants questions', () => {
    // A legacy intake carrying the pre-fix custom string: the predicates
    // fold it, so the merchants card and the recon follow-up stay visible.
    const legacy = {
      engagementType: 'bookkeeping',
      paymentMethods: ['Credit / debit card'],
      merchantAccounts: [{ name: 'Square', processor: 'Square' }],
    } as unknown as WizardAnswers
    expect(merchants.when?.(legacy)).toBe(true)
    expect(merchantRecon.when?.(legacy)).toBe(true)
  })

  it('online payments qualify too (folded), Zelle never does', () => {
    const online = { engagementType: 'bookkeeping', paymentMethods: ['Online payments'] } as unknown as WizardAnswers
    expect(merchants.when?.(online)).toBe(true)
    const zelle = { engagementType: 'bookkeeping', paymentMethods: ['Zelle'] } as unknown as WizardAnswers
    expect(merchants.when?.(zelle)).toBe(false)
  })
})

/**
 * M1 (A12, 10_10 00:46:13 + 00:50:38): "record deposits is thrown in with
 * monthly, but it should have been part of the weekly" - the estimate's
 * recurring groups must follow the committed routine schedule.
 */
describe('M1/A12: weekly_services_group_weekly_on_estimate', () => {
  it('record_bills and record_deposits land in the weekly bucket when scheduled weekly', async () => {
    const { buildBucketedEstimate } = await import('../review-estimate')
    const quote = {
      billingCycle: 1,
      lines: [
        { service_key: 'record_bills', product_name: 'Record Bills', unit_price: 25, quantity: 1, amount: 25, bucket: 'monthly', unpriced: false },
        { service_key: 'record_deposits', product_name: 'Record Deposits', unit_price: null, quantity: 1, amount: null, bucket: 'monthly', unpriced: true },
      ],
      totals: {
        totalMonthly: 25,
        totalQuarterly: 0,
        annualExcludingFebruaryBilled: 0,
        totalPayrollMonthly: 0,
        totalFebruaryBilledAnnual: 0,
        totalOneTime: 0,
        effectiveMonthly: 25,
      },
    }
    const answers = {
      engagementType: 'bookkeeping',
      routineSchedule: {
        'record-bills': { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 },
        'record-deposits': { bucket: 'weekly', order: 1, weekdays: [5], everyNWeeks: 1 },
      },
    } as unknown as WizardAnswers
    const estimate = buildBucketedEstimate(quote as never, answers)
    const weekly = estimate.groups.find((g) => g.bucket === 'weekly')
    expect(weekly?.lines.map((l) => l.key).sort()).toEqual(['record_bills', 'record_deposits'])
    // Nothing leaks into a monthly group.
    expect(estimate.groups.find((g) => g.bucket === 'monthly')).toBeUndefined()
  })
})

/**
 * M1 (B3, 10_10 00:43:18-00:44:55): "online access it's only giving us the
 * option of the two… should show six total instead of two. Two checking
 * accounts, two credit cards, and then two loans… re-saving doesn't
 * update." Repro at the data level first, then the wizard flow.
 */
describe('M1/B3: online_access_lists_all_statement_accounts', () => {
  const SIX = {
    engagementType: 'bookkeeping',
    checkingAccounts: [
      { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
      { name: 'Chase Checking · 2200', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '2200' },
    ],
    creditCardAccounts: [
      { name: 'Amex Credit card · 7007', accountType: 'credit_card', proofCategory: 'statement', institution: 'Amex', last4: '7007' },
      { name: 'Capital One Credit card · 3310', accountType: 'credit_card', proofCategory: 'statement', institution: 'Capital One', last4: '3310' },
    ],
    loanAccounts: [
      { name: 'Delivery van loan', accountType: 'loan', proofCategory: 'statement', lender: 'Ford Credit' },
      { name: 'SBA loan', accountType: 'loan', proofCategory: 'statement', lender: 'Becker Financial' },
    ],
  } as unknown as WizardAnswers

  it('statementAccountRefs returns every named statement-proof account', async () => {
    const { statementAccountRefs } = await import('../registry')
    expect(statementAccountRefs(SIX)).toHaveLength(6)
  })

  it('the checklist question offers all six', () => {
    const q = findQuestion('access', 'online-access')!
    expect(q.dynamicOptions?.(SIX)).toHaveLength(6)
  })
})

/**
 * M1 (B3 root cause, 10_10 00:44:05): "for some reason those got
 * deselected… when we select those specific things again and we save them
 * to give online access, it doesn't update." Two rapid edits from the same
 * rendered array clobber each other - the second commit computes from the
 * pre-first-edit prop and the first edit dies.
 */
describe('M1/B3: online_access_checks_never_clobber', () => {
  it('two rapid grant-access commits both survive', async () => {
    const { render, fireEvent, screen } = await import('@testing-library/react')
    const { useState } = await import('react')
    const { QuestionScreen } = await import('../screens')
    const q = findQuestion('balance', 'checking-accounts')!
    const committed: unknown[] = []
    function Harness() {
      const [answers, setAnswers] = useState<WizardAnswers>({
        engagementType: 'bookkeeping',
        checkingAccounts: [
          { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
          { name: 'Chase Checking · 2200', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '2200' },
        ],
      } as WizardAnswers)
      return (
        <QuestionScreen
          q={q}
          answers={answers}
          onApply={(p) => {
            committed.push(p)
            setAnswers((a) => ({ ...a, ...p }))
          }}
          onAdvance={() => {}}
          onPickOption={() => {}}
        />
      )
    }
    render(<Harness />)
    // Two rapid clicks in ONE React batch (Jason's rapid-fire flow) - both
    // handlers run before the prop refreshes, the exact clobber window.
    const { act } = await import('react')
    const c0 = screen.getByTestId('grant-access-0')
    const c1 = screen.getByTestId('grant-access-1')
    act(() => {
      c0.click()
      c1.click()
    })
    const final = committed.at(-1) as {
      checkingAccounts: { grantLoginAccess?: boolean }[]
    }
    expect(final.checkingAccounts[0].grantLoginAccess).toBe(true)
    expect(final.checkingAccounts[1].grantLoginAccess).toBe(true)
  })
})

/**
 * M1 (B3, full-fidelity repro, 10_10 00:43:18-00:44:55): Jason's exact
 * flow - enter 2 checking + 2 credit cards + 2 loans through the real
 * mini-forms, advance to online access, and the checklist must offer all
 * six ("should show six total instead of two").
 */
describe('M1/B3 (flow repro): six_entered_accounts_all_reach_online_access', () => {
  it('2 checking + 2 cards + 2 loans entered via the mini-forms all list', async () => {
    const { render, fireEvent, screen, act } = await import('@testing-library/react')
    const { IntakeWizard } = await import('../wizard')
    const { flattenScreens } = await import('../registry')

    const start: WizardAnswers = { engagementType: 'bookkeeping', equitySetup: 'grouped' } as WizardAnswers
    const idx = flattenScreens(start).findIndex(
      (s) => s.kind === 'question' && s.questionId === 'checking-accounts',
    )
    render(
      <IntakeWizard
        intakeId={7}
        status="in_progress"
        initialAnswers={start}
        initialScreenIndex={idx}
        canConvert={false}
        managers={[]}
        bookkeepers={[]}
        clientId={null}
      />,
    )

    const { within } = await import('@testing-library/react')
    const qs = () => within(screen.getByTestId('question-screen'))
    const addAccount = async (bankIdx: number, last4: string) => {
      fireEvent.click(qs().getByTestId('add-account'))
      fireEvent.click(qs().getByTestId(`bank-select-${bankIdx}`))
      fireEvent.click(qs().getByTestId('bank-option-1'))
      fireEvent.change(qs().getByTestId(`last4-${bankIdx}`), { target: { value: last4 } })
    }
    const advance = () => fireEvent.click(qs().getByTestId('continue'))

    // Checking x2.
    await addAccount(0, '4411')
    await addAccount(1, '2200')
    advance()
    // Savings: skip. Credit cards x2.
    advance()
    await addAccount(0, '7007')
    await addAccount(1, '3310')
    advance()
    // Vehicles, other assets: skip.
    advance()
    advance()
    // Loans x2 (free-text name + lender write-in).
    fireEvent.click(qs().getByTestId('add-account'))
    fireEvent.change(qs().getByLabelText('Loan name 1'), { target: { value: 'Delivery van loan' } })
    fireEvent.click(qs().getByTestId('add-account'))
    fireEvent.change(qs().getByLabelText('Loan name 2'), { target: { value: 'SBA loan' } })
    advance()
    // Equity setup is answered (grouped); the access question comes after income.
    const onlineAccess = () => screen.getByTestId('question-screen').getAttribute('data-question')
    let guard = 0
    while (onlineAccess() !== 'online-access' && guard < 20) {
      // Required selects block Continue until picked - answer no/skip.
      const noPick = qs().queryByTestId('option-no')
      if (noPick && qs().queryByTestId('continue') == null) {
        fireEvent.click(noPick)
      } else if (noPick && onlineAccess() !== 'equity-setup') {
        // Select screens with a continue: still answer no to keep the path lean.
        fireEvent.click(noPick)
      }
      advance()
      guard += 1
    }
    expect(onlineAccess()).toBe('online-access')
    const options = qs().getAllByRole('checkbox').length
    expect(options).toBe(6)
  }, 20_000)
})

/**
 * M1 (B3 root cause, confirmed on the demo intake's prod form_data): bank
 * picked, last-4 skipped (K7 makes last-4 discovery-optional) -> the
 * derived name stayed '' and statementAccountRefs silently dropped all
 * four money accounts. The 2-of-6 checklist. The derivation must produce
 * "Chase Checking" without the last-4, so nameless accounts can't exist.
 */
describe('M1/B3: bank_only_account_derives_a_name_and_lists', () => {
  it('accountLabel falls back to "Chase Checking" without a last-4', async () => {
    const { accountLabel } = await import('@/shared/lib/account-label')
    expect(accountLabel({ institution: 'Chase', accountType: 'checking', last4: null })).toBe('Chase Checking')
    expect(accountLabel({ institution: 'Chase', accountType: 'checking', last4: '4411' })).toBe('Chase Checking · 4411')
    // No institution, no name: the type word is the most honest label left.
    expect(accountLabel({ institution: null, accountType: 'checking', last4: null })).toBe('Checking')
    expect(accountLabel({ institution: null, accountType: null, last4: null })).toBe('Account')
    // A stored name always wins (legacy rows).
    expect(accountLabel({ name: 'Legacy Checking', institution: 'Chase', accountType: 'checking', last4: null })).toBe('Legacy Checking')
  })

  it('statementAccountRefs includes bank-only statement accounts (Jason\'s prod state)', async () => {
    const { statementAccountRefs } = await import('../registry')
    const prodState = {
      checkingAccounts: [
        { name: 'Chase Checking', institution: 'Chase', institutionId: 1, proofCategory: 'statement', grantLoginAccess: true },
        { name: 'Bank of America Checking', institution: 'Bank of America', institutionId: 3, proofCategory: 'statement', grantLoginAccess: true },
      ],
      creditCardAccounts: [
        { name: 'Capital One Credit card', institution: 'Capital One', institutionId: 8, proofCategory: 'statement', grantLoginAccess: true },
        { name: 'Amex Credit card', institution: 'Amex', institutionId: 7, proofCategory: 'statement', grantLoginAccess: true },
      ],
      loanAccounts: [
        { name: 'Pinto (vehicle loan)', proofCategory: 'statement', grantLoginAccess: true },
        { name: 'Commercial Loan', proofCategory: 'statement', grantLoginAccess: true },
      ],
    } as unknown as WizardAnswers
    expect(statementAccountRefs(prodState)).toHaveLength(6)
    const q = findQuestion('access', 'online-access')!
    expect(q.dynamicOptions?.(prodState)).toHaveLength(6)
  })
})

/**
 * M1 (B4, 10_10 00:24:30): "this is jumping me back, but then it doesn't
 * take me back to where I just was… it doesn't give me a go back to what
 * are we taking on." A qualifier-link jump pushes the origin; Back returns
 * there first, then the normal walk resumes.
 */
describe('M1/B4: back_after_qualifier_jump_returns_to_origin', () => {
  it('services -> factor link -> Back -> services again', async () => {
    const { render, fireEvent, screen } = await import('@testing-library/react')
    const { IntakeWizard } = await import('../wizard')
    const { flattenScreens } = await import('../registry')

    const start: WizardAnswers = {
      engagementType: 'bookkeeping',
      equitySetup: 'grouped',
      hasPayroll: true,
      payrollProvider: 'Gusto',
      payrollFrequency: 'weekly',
      payrollSelfProcessed: true,
      serviceKeys: ['bank_feed_management', 'account_reconciliations', 'monthly_reporting_10'],
    } as unknown as WizardAnswers
    const idx = flattenScreens(start).findIndex(
      (s) => s.kind === 'question' && s.chapterId === 'services' && s.questionId === 'services',
    )
    render(
      <IntakeWizard
        intakeId={7}
        status="in_progress"
        initialAnswers={start}
        initialScreenIndex={idx}
        canConvert={false}
        managers={[]}
        bookkeepers={[]}
        clientId={null}
      />,
    )
    const { waitFor } = await import('@testing-library/react')
    // Transitions render the exit + enter copies together; read once settled.
    const current = async () => {
      // Transitions keep the exit copy mounted in jsdom (no transitionend);
      // the entering (current) screen is the LAST question-screen element.
      await waitFor(() => expect(screen.getAllByTestId('question-screen').length).toBeGreaterThan(0))
      const els = screen.getAllByTestId('question-screen')
      return els[els.length - 1]!.getAttribute('data-question')
    }
    expect(await current()).toBe('services')

    // The qualifier drop-down jumps to the hero card that qualified it.
    fireEvent.click(screen.getByTestId('factor-payroll'))
    expect(await current()).toBe('payroll-services')

    // B4 fix: Back returns to the jump ORIGIN, not walk-previous.
    // (Transitions mount two screen copies in jsdom - click the last one.)
    const back = () => {
      const els = screen.getAllByTestId('back-link')
      fireEvent.click(els[els.length - 1]!)
    }
    back()
    expect(await current()).toBe('services')

    // The stack is drained: the next Back is the normal walk-previous.
    back()
    expect(await current()).not.toBe('payroll-services')
    expect(await current()).not.toBe('services')
  })
})

/**
 * M1 (B7, 10_10 00:33:59): "Why did that default to annual? That should
 * have defaulted to monthly… it should default to the book closing
 * frequency." The custom-work adder kept the last-used cadence - adding an
 * ANNUAL item made the next one annual ("defaulted to annual based on the
 * things we entered"). Now it resets to the closing frequency after every
 * add.
 */
describe('M1/B7: custom_routine_defaults_to_closing_frequency', () => {
  it('an annual add does not leak into the next add (resets to monthly close)', async () => {
    const { render, fireEvent, screen } = await import('@testing-library/react')
    const { CustomWorkAdder } = await import('../custom-work')
    const applied: Record<string, unknown>[] = []
    render(
      <CustomWorkAdder
        answers={{ bookkeepingFrequency: 'monthly' } as unknown as WizardAnswers}
        onApply={(p) => applied.push(p as Record<string, unknown>)}
      />,
    )
    // First add: an ANNUAL item (Jason's "Matt's Famous Report").
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: "Matt's Famous Report" } })
    fireEvent.change(screen.getByTestId('custom-work-cadence'), { target: { value: 'annual' } })
    fireEvent.click(screen.getByTestId('custom-work-add'))

    // Second add: the cadence must be the monthly default again - not annual.
    fireEvent.click(screen.getByTestId('custom-work-open'))
    expect(screen.getByTestId('custom-work-cadence')).toHaveValue('monthly')
    fireEvent.change(screen.getByTestId('custom-work-name'), {
      target: { value: 'Ask client for personal-card business-expense breakdown' },
    })
    fireEvent.click(screen.getByTestId('custom-work-add'))

    expect(applied).toHaveLength(2)
    const second = applied[1] as {
      customRecurringRules: { title: string; scheduleType: string }[]
    }
    expect(second.customRecurringRules[0]!.scheduleType).toBe('monthly')
  })
})
