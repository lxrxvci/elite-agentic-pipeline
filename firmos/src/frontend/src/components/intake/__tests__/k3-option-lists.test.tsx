import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, mergeListOptions, registerCustomAddonServiceKeys, type OptionListValueLite, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * K3 (DB1/J1/J2): the intake consumes the universal option lists - customs
 * persist and return first-class, type-aheads read the lists, and every
 * add-new lands in the database for future intakes.
 */

function Harness({
  q,
  initial,
  optionLists = {},
  onAddOptionListValue,
  onAdvance,
  vendorCatalog = [{ id: 41, name: 'Rent', defaultPortalUrl: null, sopTemplateId: null, reusable: true }],
}: {
  q: QuestionDef
  initial: WizardAnswers
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
  onAdvance?: () => void
  vendorCatalog?: { id: number; name: string; defaultPortalUrl: string | null; sopTemplateId: number | null; reusable: boolean }[]
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        intakeId={7}
        vendorCatalog={vendorCatalog}
        sopTemplates={[]}
        onAddVendor={async (name) => ({ id: 99, name, defaultPortalUrl: null, sopTemplateId: null, reusable: true })}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={(v) => setAnswers((a) => ({ ...a, ...q.apply(a, v) }))}
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('mergeListOptions', () => {
  it('appends list values fold-deduped against statics, statics first', () => {
    const merged = mergeListOptions(
      [
        { value: 'existing', label: 'Already on QuickBooks Online' },
        { value: 'none', label: 'No QuickBooks yet' },
      ],
      'accounting_software',
      {
        accounting_software: [
          { id: 1, name: 'Xero' },
          { id: 2, name: 'none' }, // exact fold of a static value - deduped
          { id: 3, name: 'Wave' },
        ] as OptionListValueLite[],
      },
    )
    expect(merged.map((o) => o.value)).toEqual(['existing', 'none', 'Xero', 'Wave'])
  })

  it('no list key returns the statics untouched', () => {
    const statics = [{ value: 'a', label: 'A' }]
    expect(mergeListOptions(statics, undefined, {})).toBe(statics)
  })
})

describe('select cards from the list (referral)', () => {
  const referral = findQuestion('entity', 'referral')!

  it('a custom typed on a prior intake returns as a first-class card', () => {
    render(
      <Harness
        q={referral}
        initial={{}}
        optionLists={{ referral_sources: [{ id: 5, name: 'Chamber of Commerce' } as OptionListValueLite] }}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'How did they find us?' }))
    const card = screen.getByTestId('option-Chamber of Commerce')
    fireEvent.click(card)
    expect(answersNow().referralSource).toBe('Chamber of Commerce')
  })

  it('custom_answer_never_stranded: typing Other and continuing persists to the list (J2)', async () => {
    const onAdd = vi.fn(async (_key: string, name: string) => ({ id: 9, name }) as OptionListValueLite)
    render(<Harness q={referral} initial={{}} optionLists={{}} onAddOptionListValue={onAdd} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'How did they find us?' }))
    fireEvent.click(screen.getByTestId('option-Other'))
    fireEvent.change(screen.getByTestId('custom-input-referral'), { target: { value: 'Met at a BNI meeting' } })
    fireEvent.click(screen.getByTestId('continue'))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('referral_sources', 'Met at a BNI meeting'))
  })
})

describe('multi chips from the list (payment methods)', () => {
  const methods = findQuestion('income', 'payment-methods')!

  it('every_add_new_persists_globally: the add-new chip persists and selects in one tap (J1)', async () => {
    const onAdd = vi.fn(async (_key: string, name: string) => ({ id: 12, name }) as OptionListValueLite)
    render(<Harness q={methods} initial={{}} optionLists={{}} onAddOptionListValue={onAdd} />)

    fireEvent.click(screen.getByTestId('multi-input'))
    fireEvent.click(screen.getByTestId('multi-add-toggle'))
    fireEvent.change(screen.getByTestId('multi-add-input'), { target: { value: 'Zelle' } })
    fireEvent.click(screen.getByTestId('multi-add-submit'))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('payment_methods', 'Zelle'))
    await waitFor(() => expect(answersNow().paymentMethods).toContain('Zelle'))
  })

  it('list values render as chips beside the canonical keys', () => {
    render(
      <Harness
        q={methods}
        initial={{}}
        optionLists={{ payment_methods: [{ id: 3, name: 'Venmo' } as OptionListValueLite] }}
      />,
    )
    fireEvent.click(screen.getByTestId('multi-input'))
    fireEvent.click(screen.getByTestId('chip-Venmo'))
    expect(answersNow().paymentMethods).toContain('Venmo')
    // Canonical keys still answer by key (merchant logic untouched).
    fireEvent.click(screen.getByTestId('chip-card'))
    expect(answersNow().paymentMethods).toContain('card')
  })
})

describe('list-backed text fields (industry + report names)', () => {
  const dba = findQuestion('entity', 'dba-industry')!

  it('the industry field type-aheads the industries list and persists a new one on commit', async () => {
    const onAdd = vi.fn(async (_key: string, name: string) => ({ id: 21, name }) as OptionListValueLite)
    render(
      <Harness
        q={dba}
        initial={{}}
        optionLists={{ industries: [{ id: 20, name: 'Construction' } as OptionListValueLite] }}
        onAddOptionListValue={onAdd}
      />,
    )
    // The datalist offers the list's values.
    expect(screen.getByTestId('datalist-industry')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Industry (optional)' }), { target: { value: 'Hot air balloon repair' } })
    fireEvent.click(screen.getByTestId('continue'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('industries', 'Hot air balloon repair'))
  })

  it('a report name persists to report_types when the item is added', async () => {
    const onAdd = vi.fn(async (_key: string, name: string) => ({ id: 30, name }) as OptionListValueLite)
    const reports = findQuestion('reporting', 'reports')!
    render(<Harness q={reports} initial={{}} optionLists={{}} onAddOptionListValue={onAdd} />)

    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Washington Combined Report' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'annual' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'SOP' }))
    fireEvent.click(screen.getByRole('option', { name: 'Create new SOP' }))
    fireEvent.click(screen.getByTestId('add-another'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('report_types', 'Washington Combined Report'))
  })
})

describe('vendor catalog (record-bills)', () => {
  const recordBills = findQuestion('reporting', 'record-bills')!

  it('reuses an existing vendor and persists a one-off vendor before advancing', async () => {
    const onAdvance = vi.fn()
    render(<Harness q={recordBills} initial={{}} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('option-yes'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Vendors' }))
    expect(screen.queryByRole('option', { name: 'Rent' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'All vendors' }))
    fireEvent.click(screen.getByRole('option', { name: 'Rent' }))
    expect(answersNow().recordBillVendors).toContain('Rent')
    fireEvent.click(screen.getByTestId('vendor-input'))
    fireEvent.click(screen.getByTestId('vendor-add-toggle'))
    fireEvent.change(screen.getByLabelText('New option name'), { target: { value: 'One custom vendor' } })
    fireEvent.click(screen.getByTestId('vendor-add-submit'))
    await screen.findByRole('heading', { name: 'One custom vendor' })
    for (const vendorName of ['Rent', 'One custom vendor']) {
      fireEvent.click(screen.getByRole('combobox', { name: `SOP for ${vendorName}` }))
      fireEvent.click(screen.getByRole('option', { name: 'Create new SOP' }))
    }
    expect(screen.getByTestId('inline-followup-pay-bills')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'No, they pay their own' }))
    await waitFor(() => expect(screen.getByTestId('continue')).toBeEnabled())
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(answersNow().vendorAssignments).toHaveLength(2)
    expect(answersNow().vendorAssignments?.map((vendor) => vendor.vendorName)).toEqual(
      expect.arrayContaining(['Rent', 'One custom vendor']),
    )
  })
})

describe('services screen from the catalog (K3/J16)', () => {
  const servicesQ = findQuestion('services', 'services')!
  const catalog = [
    { serviceKey: 'invoicing', productName: 'Invoicing', isStandard: false, isAddon: true, isActive: true },
    { serviceKey: 'class_tracking', productName: 'Class tracking', isStandard: false, isAddon: true, isActive: false },
    { serviceKey: 'weekend_emergency_catch_up', productName: 'Weekend emergency catch-up', isStandard: false, isAddon: true, isActive: true },
    { serviceKey: 'bank_feed_management', productName: 'Bank Feed Management', isStandard: true, isAddon: false, isActive: true },
    { serviceKey: 'account_reconciliations', productName: 'Account Reconciliations', isStandard: true, isAddon: false, isActive: true },
  ]

  it('custom catalog add-ons render as toggles; hidden rows disappear; standards stay', () => {
    render(<Harness q={servicesQ} initial={{}} />)
    // Without a catalog prop the registry statics render (fallback).
    expect(screen.getByTestId('addon-invoicing')).toBeInTheDocument()
    expect(screen.getByTestId('addon-class_tracking')).toBeInTheDocument()
  })

  it('catalog-driven: custom add-on toggles on, inactive add-on hides', () => {
    // The wizard registers catalog add-on keys on load - mirror that here.
    registerCustomAddonServiceKeys(['weekend_emergency_catch_up'])
    const catalogHarness = render(<ServicesHarness catalogRows={catalog} />)
    expect(catalogHarness.getByTestId('addon-weekend_emergency_catch_up')).toBeInTheDocument()
    expect(catalogHarness.queryByTestId('addon-class_tracking')).not.toBeInTheDocument()
    expect(catalogHarness.getByTestId('standard-bank_feed_management')).toBeInTheDocument()
    fireEvent.click(catalogHarness.getByTestId('addon-weekend_emergency_catch_up'))
    expect(JSON.parse(catalogHarness.getByTestId('answers').textContent ?? '{}').serviceKeys).toContain(
      'weekend_emergency_catch_up',
    )
  })
})

/** ServicesScreen through the real question, with the catalog prop. */
function ServicesHarness({ catalogRows }: { catalogRows: import('../registry').ServiceCatalogRowLite[] }) {
  const q = findQuestion('services', 'services')!
  const [answers, setAnswers] = useState<WizardAnswers>({})
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
        servicesCatalog={catalogRows}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}
