import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
// (vi is used by the D5 suite's module mocks below)
import { useState } from 'react'

import { CustomWorkAdder } from '../custom-work'
import { registerCustomAddonServiceKeys, SERVICES_ADDON_OPTIONS, findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * K6 (meeting 09_30): retro bulk discount, custom work from the services
 * area, and the industry suggestion engine (suggestive, never generative).
 */

// ── D3/D4: the custom-work adder ──

function WorkHarness({ initial = {}, catalogAdds }: { initial?: WizardAnswers; catalogAdds: string[] }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <CustomWorkAdder
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAddToCatalog={(name) => catalogAdds.push(name)}
        catalog={[{ id: 1, name: 'Weekly deposit review' }]}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
      <pre data-testid="catalog-adds">{JSON.stringify(catalogAdds)}</pre>
    </div>
  )
}

describe('custom work from the services review area (D3/D4)', () => {
  it('a recurring custom task lands on customRecurringRules and its title persists to the catalog', () => {
    const catalogAdds: string[] = []
    render(<WorkHarness catalogAdds={catalogAdds} />)
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: 'Quarterly sales-tax prep' } })
    fireEvent.change(screen.getByTestId('custom-work-cadence'), { target: { value: 'quarterly' } })
    fireEvent.click(screen.getByTestId('custom-work-add'))

    const answers = JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
    expect(answers.customRecurringRules).toEqual([
      expect.objectContaining({ title: 'Quarterly sales-tax prep', scheduleType: 'quarterly' }),
    ])
    expect(JSON.parse(screen.getByTestId('catalog-adds').textContent ?? '[]')).toEqual(['Quarterly sales-tax prep'])
  })

  it('a one-time custom item needs a price and becomes a priced one-time line', () => {
    render(<WorkHarness catalogAdds={[]} />)
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: 'Cleanup day' } })
    fireEvent.change(screen.getByTestId('custom-work-cadence'), { target: { value: 'one_time' } })
    // J14: no price, no add (the button stays disabled - never guessed).
    expect(screen.getByTestId('custom-work-add')).toBeDisabled()
    fireEvent.change(screen.getByTestId('custom-work-price'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('custom-work-add'))

    const answers = JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
    expect(answers.customItems).toEqual([
      expect.objectContaining({ productName: 'Cleanup day', unitPrice: 400, frequency: 'one_time' }),
    ])
  })
})

// ── D2: industry suggestions ──

describe('industry suggestions (D2 + J8)', () => {
  const servicesQ = findQuestion('services', 'services')!

  function ServicesHarness({ suggestions }: { suggestions: { id: number; serviceKey: string; explainer: string }[] }) {
    const [answers, setAnswers] = useState<WizardAnswers>({ engagementType: 'bookkeeping' })
    const q: QuestionDef = servicesQ
    return (
      <div>
        <QuestionScreen
          q={q}
          answers={answers}
          onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
          onAdvance={() => {}}
          onPickOption={() => {}}
          industrySuggestions={suggestions}
        />
        <pre data-testid="answers">{JSON.stringify(answers)}</pre>
      </div>
    )
  }

  it('industry_suggests_never_autoselects: suggestions render with explainers and add only on click', () => {
    render(
      <ServicesHarness
        suggestions={[
          { id: 1, serviceKey: 'job_costing', explainer: 'Construction clients track income and expenses per job.' },
        ]}
      />,
    )
    registerCustomAddonServiceKeys(['job_costing']) // the wizard does this at catalog load
    const row = screen.getByTestId('suggestion-job_costing')
    expect(row).toHaveTextContent('per job')
    // Suggestive, not generative: nothing is on until clicked.
    expect(JSON.parse(screen.getByTestId('answers').textContent ?? '{}').serviceKeys ?? []).toEqual([])

    fireEvent.click(screen.getByTestId('suggestion-add-job_costing'))
    const after = JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
    expect(after.serviceKeys).toContain('job_costing')
  })

  it('therapist_tracking_not_standard: therapist tracking is off the standard add-ons', () => {
    expect(SERVICES_ADDON_OPTIONS.some((o) => o.value === 'additional_therapist_tracking')).toBe(false)
  })
})

// ── D5: the estimate's block order ──
import { ReviewScreen } from '../review-screen'
import type { Quote } from '@firmos/domain'

vi.mock('@/server/actions/intake', () => ({
  checkDuplicates: vi.fn(async () => ({ ok: true, data: [] })),
  submitIntakeForReview: vi.fn(async () => ({ ok: true, data: {} })),
}))
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true, data: { to: 'x@y.z' } })),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ORDER_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
    { service_key: 'qbo_setup', product_name: 'QBO Setup', unit_price: 150, quantity: 1, amount: 150, bucket: 'one_time', unpriced: false },
    { service_key: 'retroactive_bookkeeping', product_name: 'Retroactive Bookkeeping', unit_price: 100, quantity: 3, amount: 300, bucket: 'one_time', unpriced: false },
  ],
  totals: {
    totalMonthly: 100, totalQuarterly: 0, annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0, totalFebruaryBilledAnnual: 0, totalOneTime: 450, effectiveMonthly: 100,
  },
  qbo: null,
  retroactive: { months: 3, startMonth: { year: 2026, month: 1 }, perMonthRate: 100, baseTotal: 300, discountPercent: null, total: 300 },
}

describe('estimate_order_onetime_recurring_retro (D5)', () => {
  it('one-time fees render above recurring, retro at the bottom', () => {
    render(
      <ReviewScreen
        intakeId={1}
        answers={{
          legalName: 'Order Co',
          engagementType: 'bookkeeping',
          bookkeepingFrequency: 'monthly',
          monthlyCloseTier: '10',
          bookkeepingStartDate: '2026-04-01',
        }}
        quote={ORDER_QUOTE}
        status="draft"
        canConvert={false}
        managers={[]}
        bookkeepers={[]}
        clientId={null}
        onEdit={() => {}}
      />,
    )
    const oneTime = screen.getByTestId('estimate-one-time')
    const recurring = screen.getByTestId('estimate-recurring')
    const retro = screen.getByTestId('estimate-retro')
    // DOM order: one-time -> recurring -> retro.
    expect(oneTime.compareDocumentPosition(recurring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(recurring.compareDocumentPosition(retro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('retro-total')).toHaveTextContent('$300')
  })
})
