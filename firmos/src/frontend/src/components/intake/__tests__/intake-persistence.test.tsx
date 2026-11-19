import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

function Services({ onAdvance }: { onAdvance: () => void }) {
  const [answers, setAnswers] = useState<WizardAnswers>({ serviceKeys: [] })
  const q = findQuestion('services', 'services') as QuestionDef
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={onAdvance}
        onPickOption={() => {}}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

describe('payroll period schedules', () => {
  it('stores two searchable day rows with optional period boundaries', () => {
    const q = findQuestion('income', 'payroll-pay-dates')!
    const fields = q.fieldsValue!({
      payrollFrequency: 'semi_monthly',
      payrollPayDates: [1, 15],
      payrollPeriods: [{ startDay: 1, endDay: 14, payDay: 15 }, { startDay: 15, endDay: 31, payDay: 31 }],
    })
    expect(fields.payrollPayDate1).toBe(15)
    expect(fields.payrollPayDate2).toBe(31)
    expect(q.fields?.find((field) => field.key === 'payrollPayDate2')).toMatchObject({ kind: 'select', label: 'Second pay date (optional)' })
    expect(q.fields?.find((field) => field.key === 'payrollPayDate1')?.options).toHaveLength(32)
    expect(q.fields?.find((field) => field.key === 'payrollPeriodStart1')?.options).toHaveLength(31)
    expect(q.fields?.find((field) => field.key === 'payrollPeriodEnd1')?.options?.at(-1)).toEqual({ value: '0', label: 'End of month' })
    expect(q.fields?.find((field) => field.key === 'payrollPeriodStart2')?.visibleIf?.(fields)).toBe(true)
    expect(q.apply({ payrollFrequency: 'semi_monthly' }, fields)).toEqual({
      payrollPayWeekday: null,
      payrollPayDates: [15, 31],
      payrollPeriods: [
        { startDay: 1, endDay: 14, payDay: 15 },
        { startDay: 15, endDay: 31, payDay: 31 },
      ],
    })
    expect(q.summarize({ payrollFrequency: 'semi_monthly', payrollPayDates: [15, 31] })).toBe('Pays on days 15 and 31')
  })

  it('drops the second row for monthly payroll and leaves service choices untouched', () => {
    const q = findQuestion('income', 'payroll-pay-dates')!
    const fields = q.fieldsValue!({ payrollFrequency: 'monthly', payrollPayDates: [10], payrollPeriods: [] })
    expect(q.fields?.find((field) => field.key === 'payrollPayDate2')?.visibleIf?.(fields)).toBe(false)
    expect(q.apply({ payrollFrequency: 'monthly' }, fields).payrollPayDates).toEqual([10])
    const services = findQuestion('income', 'payroll-services')!
    expect(services.payrollServices).toBe(true)
  })

  it('allows blank and partial mappings without inventing pay dates', () => {
    const q = findQuestion('income', 'payroll-pay-dates')!
    expect(q.required).toBe(false)
    const blank = q.apply({ payrollFrequency: 'semi_monthly' }, { payrollFrequency: 'semi_monthly' })
    expect(blank).toEqual({ payrollPayWeekday: null, payrollPayDates: [], payrollPeriods: [] })
    expect(q.summarize({ payrollFrequency: 'semi_monthly', ...blank })).toBe('Pay schedule to confirm')
    const partial = q.apply({ payrollFrequency: 'semi_monthly' }, {
      payrollFrequency: 'semi_monthly',
      payrollPeriodStart1: '1',
      payrollPeriodEnd1: '15',
    })
    expect(partial).toEqual({
      payrollPayWeekday: null,
      payrollPayDates: [],
      payrollPeriods: [{ startDay: 1, endDay: 15, payDay: null }],
    })
    expect(q.summarize({ payrollFrequency: 'semi_monthly', ...partial })).toContain('Pay schedule to confirm')
  })

  it('stores end-of-month explicitly without converting it to day 31', () => {
    const q = findQuestion('income', 'payroll-pay-dates')!
    const patch = q.apply({ payrollFrequency: 'monthly' }, {
      payrollFrequency: 'monthly',
      payrollPeriodEnd1: '0',
      payrollPayDate1: '0',
    })
    expect(patch).toEqual({
      payrollPayWeekday: null,
      payrollPayDates: [0],
      payrollPeriods: [{ startDay: null, endDay: 0, payDay: 0 }],
    })
    expect(q.summarize({ payrollFrequency: 'monthly', ...patch })).toContain('Pays at the end of the month')
  })
})

describe('intake unfinished-entry persistence', () => {
  it('saves an unfinished custom-work entry before advancing', () => {
    const onAdvance = vi.fn()
    render(<Services onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: 'Annual business license renewal' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByTestId('unsaved-draft-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('unsaved-draft-save'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent!).customRecurringRules).toEqual([
      expect.objectContaining({ title: 'Annual business license renewal', scheduleType: 'monthly' }),
    ])
  })

  it('can retain the draft for editing or explicitly discard it', () => {
    const onAdvance = vi.fn()
    render(<Services onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('custom-work-open'))
    fireEvent.change(screen.getByTestId('custom-work-name'), { target: { value: 'Temporary cleanup' } })
    fireEvent.click(screen.getByTestId('continue'))
    fireEvent.click(screen.getByTestId('unsaved-draft-back'))
    expect(screen.getByTestId('custom-work-name')).toHaveValue('Temporary cleanup')
    fireEvent.click(screen.getByTestId('continue'))
    fireEvent.click(screen.getByTestId('unsaved-draft-discard'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent!).customRecurringRules ?? []).toEqual([])
  })
})
