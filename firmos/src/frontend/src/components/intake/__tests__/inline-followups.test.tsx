import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { findQuestion, flattenScreens, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

function Harness({ q, initial, onAdvance = () => {} }: {
  q: QuestionDef
  initial: WizardAnswers
  onAdvance?: () => void
}) {
  const [answers, setAnswers] = useState(initial)
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={onAdvance}
        onPickOption={(value) => setAnswers((current) => ({ ...current, ...q.apply(current, value) }))}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

describe('inline intake follow-ups', () => {
  it('collects and validates CPA details on the qualifying question, without another slide', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('entity', 'has-cpa')!} initial={{}} onAdvance={onAdvance} />)
    expect(screen.queryByLabelText('CPA name or firm')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Yes' }))
    expect(screen.getByTestId('inline-followup-cpa-details')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('CPA name or firm is required')
    fireEvent.change(screen.getByLabelText('CPA name or firm'), { target: { value: 'Cascade Tax Group' } })
    fireEvent.change(screen.getByLabelText('CPA email'), { target: { value: 'team@cascadetax.example' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent!)).toMatchObject({
      hasCpa: true,
      cpaName: 'Cascade Tax Group',
      cpaEmail: 'team@cascadetax.example',
    })
    const ids = flattenScreens({ hasCpa: true }).flatMap((item) => item.kind === 'question' ? [item.questionId] : [])
    expect(ids).toContain('has-cpa')
    expect(ids).not.toContain('cpa-details')
  })

  it('reveals equity options beneath the setup choice and keeps one Continue', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('balance', 'equity-setup')!} initial={{}} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByRole('option', { name: /^Break it down/ }))
    expect(screen.getByTestId('inline-followup-equity-breakdown')).toBeInTheDocument()
    expect(screen.getAllByTestId('continue')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Choices' }))
    fireEvent.click(screen.getByRole('option', { name: 'Owner Contributions' }))
    expect(screen.getByRole('option', { name: 'Owner Contributions' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent!)).toMatchObject({
      equitySetup: 'breakdown',
      equityBreakdown: ['contributions'],
    })
    expect(flattenScreens({ equitySetup: 'breakdown' })).not.toContainEqual({
      kind: 'question', chapterId: 'balance', questionId: 'equity-breakdown',
    })
  })

  it('reveals property setup progressively on one card with one navigation row', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('real-estate', 're-yes')!} initial={{}} onAdvance={onAdvance} />)
    expect(screen.getByTestId('property-intake-card')).toBeInTheDocument()
    expect(screen.getAllByTestId('continue')).toHaveLength(1)
    expect(screen.queryByTestId('inline-followup-re-count')).toBeNull()

    fireEvent.click(screen.getByRole('option', { name: 'Yes, real estate' }))
    expect(screen.getByTestId('inline-followup-re-count')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-followup-re-types')).toBeNull()
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Number of properties')

    fireEvent.change(screen.getByLabelText('Number of properties'), { target: { value: '2' } })
    expect(screen.getByTestId('inline-followup-re-types')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-followup-re-depreciation')).toBeNull()
    const propertyType = findQuestion('real-estate', 're-types')!.options![0]
    fireEvent.click(screen.getByRole('combobox', { name: 'Choices' }))
    fireEvent.click(screen.getByRole('option', { name: propertyType.label }))
    expect(screen.getByTestId('inline-followup-re-depreciation')).toBeInTheDocument()
    expect(screen.getAllByTestId('continue')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent!)).toMatchObject({
      isRealEstateClient: true,
      propertyCount: 2,
      propertyTypes: [propertyType.value],
    })
    const cards = flattenScreens(JSON.parse(screen.getByTestId('answers').textContent!))
    const at = cards.findIndex((card) => card.kind === 'question' && card.questionId === 're-yes')
    expect(cards.filter((card) => card.kind === 'question' && card.chapterId === 'real-estate')).toEqual([
      { kind: 'question', chapterId: 'real-estate', questionId: 're-yes' },
    ])
    expect(cards[at - 1]).toMatchObject({ questionId: 'equity-setup' })
    expect(cards[at + 1]).toMatchObject({ questionId: 'payment-methods' })
  })

  it('hides property follow-ups on No without deleting their saved answers', () => {
    const initial = {
      isRealEstateClient: true,
      propertyCount: 2,
      propertyTypes: ['land'],
      depreciationTracking: ['land'],
    }
    render(<Harness q={findQuestion('real-estate', 're-yes')!} initial={initial} />)
    expect(screen.getByLabelText('Number of properties')).toHaveValue(2)
    expect(screen.getByTestId('inline-followup-re-types')).toBeInTheDocument()
    expect(screen.getByTestId('inline-followup-re-depreciation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'No' }))
    expect(screen.queryByTestId('inline-followup-re-count')).toBeNull()
    expect(screen.queryByTestId('inline-followup-re-types')).toBeNull()
    expect(screen.queryByTestId('inline-followup-re-depreciation')).toBeNull()
    expect(JSON.parse(screen.getByTestId('answers').textContent!)).toMatchObject({ ...initial, isRealEstateClient: false })
  })
})

describe('approved grouped intake flows', () => {
  const cases: Array<{
    chapter: string
    parent: string
    children: string[]
    initial: WizardAnswers
  }> = [
    { chapter: 'entity', parent: 'tax-structure', children: ['llc-subclass'], initial: { taxStructure: 'LLC' } },
    { chapter: 'entity', parent: 'referral', children: ['referral-who'], initial: { referralSource: 'CPA referral' } },
    { chapter: 'income', parent: 'payment-methods', children: ['merchants'], initial: { paymentMethods: ['card'] } },
    { chapter: 'income', parent: 'record-deposits', children: ['make-deposits'], initial: { recordDeposits: true } },
    {
      chapter: 'income',
      parent: 'payroll',
      children: ['payroll-provider', 'payroll-frequency', 'payroll-pay-dates', 'payroll-services'],
      initial: { hasPayroll: true, payrollProvider: 'Gusto', payrollFrequency: 'weekly', payrollPayWeekday: 5 },
    },
    {
      chapter: 'reporting',
      parent: 'record-bills',
      children: ['pay-bills'],
      initial: {
        recordBills: true,
        payBills: true,
        vendorAssignments: [{ vendorId: 1, vendorName: 'SCP Distributors', frequency: 'monthly', paymentMethod: 'check' }],
      },
    },
    {
      chapter: 'software',
      parent: 'qbo-status',
      children: ['qbo-setup', 'qbo-users', 'qbo-tier'],
      initial: { quickbooksStatus: 'none' },
    },
  ]

  for (const { chapter, parent, children, initial } of cases) {
    it(`${parent} keeps its qualifying follow-ups inline with one navigation row`, () => {
      render(<Harness q={findQuestion(chapter, parent)!} initial={initial} />)
      expect(screen.getByTestId(`question-group-${parent}`)).toBeInTheDocument()
      for (const child of children) expect(screen.getByTestId(`inline-followup-${child}`)).toBeInTheDocument()
      expect(screen.getAllByTestId('continue')).toHaveLength(1)
      const cards = flattenScreens(initial)
      expect(cards).toContainEqual({ kind: 'question', chapterId: chapter, questionId: parent })
      for (const child of children) {
        expect(cards).not.toContainEqual({ kind: 'question', chapterId: chapter, questionId: child })
      }
    })
  }

  it('allows an unconfirmed monthly pay schedule without hiding payroll handling', () => {
    const onAdvance = vi.fn()
    render(<Harness
      q={findQuestion('income', 'payroll')!}
      initial={{ hasPayroll: true, payrollProvider: 'Gusto', payrollFrequency: 'monthly', payrollSelfProcessed: true }}
      onAdvance={onAdvance}
    />)
    expect(screen.getByTestId('inline-followup-payroll-pay-dates')).toBeInTheDocument()
    expect(screen.getByTestId('inline-followup-payroll-services')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('allows the processor group to continue with no processors', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('income', 'payment-methods')!} initial={{ paymentMethods: ['card'], includeMerchantReconciliation: false }} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('keeps vendor validation inside the bill-payment group', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('reporting', 'record-bills')!} initial={{ recordBills: true, payBills: true }} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByText('Select a vendor or add a one-off vendor before continuing.')).toBeInTheDocument()
    expect(onAdvance).not.toHaveBeenCalled()
  })
})
