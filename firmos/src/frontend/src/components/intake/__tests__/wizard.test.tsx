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

// The review screen's "Email proposal" button (correspondence hub) - mocked
// so the wizard suite never loads the server DB layer.
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true, data: { correspondenceId: 1, to: 'a@b.c' } })),
}))

// I3: the institution list + add-new actions behind the account mini-form
// bank dropdowns - mocked with a small seeded list.
const addInstitutionAction = vi.fn(async (name: string) => ({
  ok: true as const,
  data: { id: 99, name },
}))
vi.mock('@/server/actions/institutions', () => ({
  listInstitutionsAction: vi.fn(async () => ({
    ok: true as const,
    data: [
      { id: 1, name: 'Chase' },
      { id: 2, name: 'Columbia' },
    ],
  })),
  addInstitutionAction: (name: unknown) => addInstitutionAction(name as string),
}))

// J1 (DB1): the payroll-provider and merchant-processor lists behind the
// provider dropdown / processor item fields - mocked like the bank list.
vi.mock('@/server/actions/payroll-providers', () => ({
  listPayrollProvidersAction: vi.fn(async () => ({
    ok: true as const,
    data: [
      { id: 1, name: 'ADP' },
      { id: 2, name: 'Gusto' },
    ],
  })),
  addPayrollProviderAction: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 98, name } })),
}))
vi.mock('@/server/actions/merchant-processors', () => ({
  listMerchantProcessorsAction: vi.fn(async () => ({
    ok: true as const,
    data: [
      { id: 1, name: 'Square' },
      { id: 2, name: 'Stripe' },
    ],
  })),
  addMerchantProcessorAction: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 97, name } })),
}))

// J1 (C5/C6/C7): the contact pickers' server read - mocked with one
// existing contact and one existing client.
vi.mock('@/server/actions/contacts', () => ({
  searchContactsAction: vi.fn(async (query: string) => ({
    ok: true as const,
    data: {
      contacts:
        query.toLowerCase().includes('wren') || query.toLowerCase().includes('cascade')
          ? [
              {
                kind: 'contact' as const,
                id: 55,
                name: 'Wren Okafor',
                firstName: 'Wren',
                lastName: 'Okafor',
                entityName: null,
                email: 'wren@existing.example',
                phone: '5035550182',
              },
              {
                kind: 'contact' as const,
                id: 56,
                name: 'Cascade Tax Group',
                firstName: null,
                lastName: null,
                entityName: 'Cascade Tax Group',
                email: 'team@cascadetax.example',
                phone: null,
              },
            ]
          : [],
      clients: query.toLowerCase().includes('harbor')
        ? [{ kind: 'client' as const, id: 77, name: 'Harborline Marine Supply' }]
        : [],
    },
  })),
}))

import { IntakeWizard, AUTO_ADVANCE_MS, NOTE_DWELL_MS, SAVE_DEBOUNCE_MS, QUOTE_DEBOUNCE_MS } from '../wizard'

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
  contacts: [{ firstName: 'Wren', lastName: 'Okafor', isPrimary: true, relationshipType: 'primary_contact' }],
  taxStructure: 'LLC',
  llcSubclass: 'llc_sml',
  hasCpa: false,
  isExistingClient: false,
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
  qboUserCount: 2,
  bookkeepingStartDate: '2026-01-01',
  serviceKeys: ['bank_feed_management'],
  isRealEstateClient: false,
  hasPayroll: false,
  personalCardForBusiness: false,
  depositsNonBusiness: false,
  personalOnBusiness: false,
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  accountingMethod: 'cash',
  recordBills: false,
  sendPreliminaryReports: false,
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
    renderWizard({ legalName: 'Test Co', contacts: [{ firstName: 'Wren', isPrimary: true }] })
    // Resumes at tax-structure (legal name and main contact are answered).
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')

    fireEvent.click(screen.getByTestId('option-LLC'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')

    // I2: an LLC pick opens the tax-classification follow-up first.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + 50)
    })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'llc-subclass')

    fireEvent.click(screen.getByTestId('option-llc_sml'))
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + 50)
    })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'dba-industry')
  })
})

describe('custom "Other" option cards (I1)', () => {
  it('picking Other opens the inline input instead of auto-advancing; Continue moves on', async () => {
    vi.useFakeTimers()
    renderWizard({ legalName: 'Test Co', contacts: [{ firstName: 'Wren', isPrimary: true }] })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')

    fireEvent.click(screen.getByTestId('option-Other'))
    // The typed answer replaces the auto-advance: still on tax-structure.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + NOTE_DWELL_MS + 500)
    })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')
    const input = screen.getByTestId('custom-input-tax-structure')
    fireEvent.change(input, { target: { value: 'Series LLC taxed as a trust' } })

    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'dba-industry')

    // Autosave carried the canonical Other value plus the verbatim text.
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { taxStructure?: string | null; formData?: { customAnswers?: Record<string, string> } }
    }
    expect(last.patch.taxStructure).toBe('Other')
    expect(last.patch.formData?.customAnswers?.['tax-structure']).toBe('Series LLC taxed as a trust')
  })

  it('re-picking a listed option clears the typed custom text', async () => {
    vi.useFakeTimers()
    const answers: WizardAnswers = {
      legalName: 'Test Co',
      contacts: [{ firstName: 'Wren', isPrimary: true }],
      taxStructure: 'Other',
      customAnswers: { 'tax-structure': 'Something exotic' },
    }
    // taxStructure is already answered, so resume would skip ahead - pin the
    // screen directly.
    const idx = flattenScreens(answers).findIndex(
      (s) => s.kind === 'question' && s.questionId === 'tax-structure',
    )
    renderWizard(answers, idx)
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')
    expect(screen.getByTestId('custom-input-tax-structure')).toHaveValue('Something exotic')

    fireEvent.click(screen.getByTestId('option-LLC'))
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + 50)
    })
    // I2: the LLC subclass follow-up comes next; the custom text is cleared.
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'llc-subclass')
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { taxStructure?: string | null; formData?: { customAnswers?: Record<string, string> } }
    }
    expect(last.patch.taxStructure).toBe('LLC')
    expect(last.patch.formData?.customAnswers?.['tax-structure']).toBeUndefined()
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

describe('running notes rail', () => {
  it('appends timestamped notes and persists them through autosave', async () => {
    vi.useFakeTimers()
    renderWizard({ legalName: 'Test Co' })

    const input = screen.getByTestId('running-note-input')
    fireEvent.change(input, { target: { value: 'Owner also runs a second LLC' } })
    fireEvent.click(screen.getByTestId('running-note-add'))

    // The note lists immediately and the composer clears.
    expect(screen.getAllByTestId('running-note')).toHaveLength(1)
    expect(screen.getByText('Owner also runs a second LLC')).toBeInTheDocument()
    expect(input).toHaveValue('')

    // Autosave carries the notes array into form_data.runningNotes.
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    expect(saveIntake).toHaveBeenCalled()
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { formData?: { runningNotes?: { text: string; at: string }[] } }
    }
    expect(last.patch.formData?.runningNotes).toHaveLength(1)
    expect(last.patch.formData?.runningNotes?.[0]?.text).toBe('Owner also runs a second LLC')
    expect(typeof last.patch.formData?.runningNotes?.[0]?.at).toBe('string')
  })

  it('seeds the rail from prior answers (resume) and shows notes on the review screen', async () => {
    const reviewIndex = flattenScreens(completeAnswers).length - 1
    render(
      <IntakeWizard
        intakeId={7}
        status="in_progress"
        initialAnswers={{
          ...completeAnswers,
          runningNotes: [
            { text: 'Wants weekly deposits reviewed', at: '2026-09-22T17:30:00.000Z' },
          ],
        }}
        initialScreenIndex={reviewIndex}
        canConvert
        managers={[{ id: 1, name: 'Dana Whitfield' }]}
        bookkeepers={[{ id: 2, name: 'Jorge Medina' }]}
        clientId={null}
      />,
    )
    // Rail lists the seeded note while editing…
    expect(screen.getAllByTestId('running-note').length).toBeGreaterThan(0)
    // …and the review screen carries the same note.
    const section = screen.getByTestId('review-running-notes')
    expect(section).toHaveTextContent('Wants weekly deposits reviewed')
  })
})

describe('review screen', () => {
  const reviewIndex = flattenScreens(completeAnswers).length - 1

  it('edit links jump back to the chapter question', async () => {
    renderWizard(completeAnswers, reviewIndex)
    expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('edit-contact'))
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


describe('I2 corporate payroll auto-flag (00:48:07-00:49:44)', () => {  // S-corp answers with payroll never touched: the flag is derived, not stored.
  const scorpAnswers: WizardAnswers = {
    ...completeAnswers,
    taxStructure: 'S-corp',
    llcSubclass: null,
    hasPayroll: undefined,
    owners: [{ name: 'Wren Okafor' }],
  }
  const screenIndex = (a: WizardAnswers, questionId: string) =>
    flattenScreens(a).findIndex((s) => s.kind === 'question' && s.questionId === questionId)

  it('the payroll screen pre-selects Yes, locks No, and shows the officer callout', () => {
    renderWizard(scorpAnswers, screenIndex(scorpAnswers, 'payroll'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'payroll')
    expect(screen.getByTestId('question-callout')).toHaveTextContent(
      'Corporate officers must be paid through payroll — we\'ve pre-selected payroll.',
    )
    expect(screen.getByTestId('option-yes')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('option-no')).toHaveAttribute('aria-disabled', 'true')
  })

  it('the payroll-services card carries the recommendation badge', () => {
    renderWizard(scorpAnswers, screenIndex(scorpAnswers, 'payroll-services'))
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'payroll-services')
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(
      'Recommended - corporate officers must be on payroll',
    )
  })

  it('no badge or callout for a plain LLC', () => {
    renderWizard(completeAnswers, screenIndex(completeAnswers, 'payroll'))
    expect(screen.queryByTestId('question-callout')).toBeNull()
    expect(screen.getByTestId('option-no')).not.toHaveAttribute('aria-disabled')
  })

  it('the review screen shows the auto-flagged payroll row', () => {
    renderWizard(scorpAnswers, flattenScreens(scorpAnswers).length - 1)
    expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    expect(screen.getByText('Yes · officers must be on payroll')).toBeInTheDocument()
    expect(screen.getByText('S-corp')).toBeInTheDocument()
  })
})

describe('quote_hidden_until_review (I4, plan §3D, 00:22:46-00:24:22)', () => {
  const screenIndex = (a: WizardAnswers, questionId: string) =>
    flattenScreens(a).findIndex((s) => s.kind === 'question' && s.questionId === questionId)

  beforeEach(() => {
    // The peek flag is per-session; each test starts with a clean slate.
    sessionStorage.clear()
  })

  it('mid-wizard the rail collapses to a stub with no dollar amounts anywhere', async () => {
    renderWizard({ legalName: 'Test Co', contacts: [{ firstName: 'Wren', isPrimary: true }] })
    // The quote still prices server-side (the review will need it)…
    await waitFor(() => expect(getQuote).toHaveBeenCalled(), { timeout: 3000 })
    // …but nothing money-shaped renders: no panel, no $ text.
    expect(screen.queryByTestId('live-quote')).toBeNull()
    expect(screen.queryByTestId('quote-amount')).toBeNull()
    expect(screen.getByTestId('quote-hidden')).toBeInTheDocument()
    expect(screen.getByText('Show pricing')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$\d/)
  })

  it('the staff peek toggle reveals pricing and remembers it per session', async () => {
    renderWizard({ legalName: 'Test Co', contacts: [{ firstName: 'Wren', isPrimary: true }] })
    fireEvent.click(screen.getByTestId('quote-peek-toggle'))
    await waitFor(() => expect(screen.getByTestId('quote-amount')).toHaveTextContent('$425'), { timeout: 3000 })
    expect(sessionStorage.getItem('firmos:intake-quote-peek')).toBe('1')

    // Hide again -> back to the stub, preference cleared.
    fireEvent.click(screen.getByTestId('quote-hide-toggle'))
    expect(screen.getByTestId('quote-hidden')).toBeInTheDocument()
    expect(sessionStorage.getItem('firmos:intake-quote-peek')).toBe('0')

    // A remount in the same session remembers the peek.
    sessionStorage.setItem('firmos:intake-quote-peek', '1')
    const remount = renderWizard({ legalName: 'Test Co', contacts: [{ firstName: 'Wren', isPrimary: true }] })
    await waitFor(() => expect(remount.getByTestId('quote-amount')).toHaveTextContent('$425'), { timeout: 3000 })
    expect(sessionStorage.getItem('firmos:intake-quote-peek')).toBe('1')
  })

  it('the review screen is the reveal: the panel shows with or without the peek', async () => {
    const reviewIndex = flattenScreens(completeAnswers).length - 1
    renderWizard(completeAnswers, reviewIndex)
    const panel = await screen.findByTestId('live-quote', undefined, { timeout: 3000 })
    // The reveal moment is marked (and reduced-motion safe via CSS).
    expect(panel).toHaveAttribute('data-revealed', 'true')
    expect(panel.className).toContain('fi-quote-reveal')
    await waitFor(() => expect(screen.getByTestId('quote-amount')).toHaveTextContent('$425'), { timeout: 3000 })
    // No hide toggle on the review screen - the reveal is the point.
    expect(screen.queryByTestId('quote-hide-toggle')).toBeNull()
    // The review quote section (the quote-send source) renders fully.
    expect(screen.getByTestId('review-quote')).toBeInTheDocument()
  })

  it('no price text renders on any non-review screen with the peek off', async () => {
    // The reports screen commits priced specialty-report definitions - the
    // chips must still not leak amounts once the rail is hidden.
    const withReports: WizardAnswers = {
      ...completeAnswers,
      reportDefinitions: [
        { name: 'Oregon Special Report', frequency: 'annual', dataSource: null, estimatedHours: null, flatPrice: 200, missedFilings: 18 },
        { name: 'City lodging tax', frequency: 'monthly', dataSource: null, estimatedHours: 3, flatPrice: null, missedFilings: null },
      ],
    }
    const index = screenIndex(withReports, 'reports')
    const { container } = renderWizard(withReports, index)
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'reports')
    await waitFor(() => expect(getQuote).toHaveBeenCalled(), { timeout: 3000 })
    // Dollar-free chips…
    expect(screen.getByText(/flat price set/)).toBeInTheDocument()
    expect(screen.getByText(/3h estimated/)).toBeInTheDocument()
    // …and a whole-screen scan: no $ figure anywhere with the rail hidden.
    expect(container.textContent).not.toMatch(/\$\d/)
    expect(screen.queryByTestId('live-quote')).toBeNull()
  })
})

describe('J2/B1 spacebar regression (meeting #3, 00:04:23)', () => {
  it('spacebar_never_saves_a_text_field', async () => {
    // Pre-fix, the main-contact name round-tripped through splitFullName on
    // every keystroke: a trailing space was trimmed by the re-derived value,
    // the controlled input snapped back, and the apply fired the autosave -
    // "I can't push space... space bar saves it." The typing buffer keeps the
    // field's text exactly as typed.
    vi.useFakeTimers()
    renderWizard({ legalName: 'Test Co' })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'main-contact')

    const input = screen.getByLabelText('Full name')
    // The typing path, character by character - the space must land.
    fireEvent.change(input, { target: { value: 'Wren' } })
    fireEvent.change(input, { target: { value: 'Wren ' } })
    expect(input).toHaveValue('Wren ')
    fireEvent.change(input, { target: { value: 'Wren Okafor' } })
    expect(input).toHaveValue('Wren Okafor')

    // No submit, no advance: the wizard is still parked on main-contact.
    expect(submitIntakeForReview).not.toHaveBeenCalled()
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'main-contact')

    // And the committed answer carries the full name (split on commit).
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    expect(saveIntake).toHaveBeenCalled()
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { formData?: { contacts?: Array<{ firstName?: string; lastName?: string }> } }
    }
    expect(last.patch.formData?.contacts?.[0]).toMatchObject({ firstName: 'Wren', lastName: 'Okafor' })
  })
})

describe('J2 mandatory behavior-note overlay (E1-E3)', () => {
  // Answers complete through the income chapter's payment methods, so the
  // wizard resumes exactly at the deposits-non-business card.
  const beforeBehavior: WizardAnswers = {
    legalName: 'Test Co',
    contacts: [{ firstName: 'Wren', isPrimary: true }],
    taxStructure: 'LLC',
    llcSubclass: 'llc_sml',
    hasCpa: false,
    engagementType: 'bookkeeping',
    quickbooksStatus: 'existing',
    qboUserCount: 2,
    serviceKeys: ['bank_feed_management'],
    isExistingClient: false,
    bookkeepingStartDate: '2026-01-01',
    isRealEstateClient: false,
    paymentMethods: ['check'],
  }

  it('yes_answer_requires_explanation_note', async () => {
    renderWizard(beforeBehavior)
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'deposits-non-business')

    // Picking yes opens the blocking overlay instead of advancing.
    fireEvent.click(screen.getByTestId('option-yes'))
    expect(screen.getByTestId('behavior-note-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'deposits-non-business')

    // Empty cannot save (the button is disabled) and Escape cannot dismiss.
    expect(screen.getByTestId('behavior-note-save')).toBeDisabled()
    fireEvent.keyDown(screen.getByTestId('behavior-note-dialog'), { key: 'Escape' })
    expect(screen.getByTestId('behavior-note-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'deposits-non-business')

    // Saving the note applies the yes + note and moves on (the advance rides
    // the standard auto-advance timer, so the save flush sees the applied yes).
    fireEvent.change(screen.getByTestId('behavior-note-input'), {
      target: { value: 'Owner covers a bill from his personal account some months' },
    })
    fireEvent.click(screen.getByTestId('behavior-note-save'))
    expect(screen.queryByTestId('behavior-note-dialog')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'personal-on-business'),
    )

    // The note persists into form_data.behaviorNotes with the answer.
    await waitFor(() => expect(saveIntake).toHaveBeenCalled())
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { formData?: { depositsNonBusiness?: boolean; behaviorNotes?: Record<string, string> } }
    }
    expect(last.patch.formData?.depositsNonBusiness).toBe(true)
    expect(last.patch.formData?.behaviorNotes?.['deposits-non-business']).toBe(
      'Owner covers a bill from his personal account some months',
    )
  })

  it('go back discards the yes pick entirely; a later no retires a stored note', async () => {
    vi.useFakeTimers()
    renderWizard(beforeBehavior)
    fireEvent.click(screen.getByTestId('option-yes'))
    fireEvent.click(screen.getByTestId('behavior-note-cancel'))
    // Nothing applied: still on the card, no selection.
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'deposits-non-business')
    expect(screen.getByTestId('option-yes')).not.toHaveAttribute('data-selected', 'true')

    // A no advances straight away and clears any prior note.
    fireEvent.click(screen.getByTestId('option-no'))
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS + 50)
    })
    expect(screen.getByTestId('question-screen')).toHaveAttribute('data-question', 'personal-on-business')
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50)
    })
    expect(saveIntake).toHaveBeenCalled()
    const last = saveIntake.mock.calls.at(-1)?.[0] as {
      patch: { formData?: { depositsNonBusiness?: boolean; behaviorNotes?: Record<string, string> } }
    }
    expect(last.patch.formData?.depositsNonBusiness).toBe(false)
    expect(last.patch.formData?.behaviorNotes?.['deposits-non-business']).toBeUndefined()
  })
})
