import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type OptionListValueLite, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * L2 (D1/D3, 10_06 00:16:31-00:21:42): "What should we do for payroll?" is
 * the TWO core picks as a vertical stack; secondary services present after a
 * core pick, never auto-selected, from the persistent payroll_services DB.
 */

function Harness({
  initial,
  optionLists,
  onAddOptionListValue,
}: {
  initial: WizardAnswers
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  const q = findQuestion('income', 'payroll-services')!
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
const BASE = { hasPayroll: true } as WizardAnswers

describe('L2/D1+D3: payroll_services_persist_globally_never_autoselected (10_06)', () => {
  it('two core picks in a stack; secondary presents only AFTER a core pick, never auto-selected', () => {
    render(
      <Harness
        initial={BASE}
        optionLists={{
          payroll_services: [
            { id: 1, name: 'Quarterly filings' },
            { id: 2, name: 'State and local payments' },
            { id: 3, name: 'Hours and commission calculations' },
          ],
        }}
      />,
    )
    const core = screen.getByTestId('payroll-core-stack')
    expect(core.textContent).toContain('They process their own payroll')
    expect(core.textContent).toContain('We process their payroll')
    // Secondary hidden until a core pick.
    expect(screen.queryByTestId('payroll-secondary')).toBeNull()

    fireEvent.click(screen.getByTestId('payroll-core-process_payroll'))
    expect(answersNow().serviceKeys).toContain('process_payroll')
    const secondary = screen.getByTestId('payroll-secondary')
    expect(secondary).toBeInTheDocument()
    // The three canonical services present ONCE (seeded labels fold-dedupe
    // against the statics - never double-rendered), NONE selected.
    for (const label of ['Quarterly filings', 'State and local payments', 'Hours and commission calculations']) {
      expect(screen.getAllByTestId(`payroll-service-${label}`)).toHaveLength(1)
    }
    expect(answersNow().serviceKeys?.filter((k) => k.startsWith('payroll_'))).toEqual([])
  })

  it('the two cores are mutually exclusive - switching clears the other', () => {
    render(<Harness initial={BASE} optionLists={{ payroll_services: [] }} />)
    fireEvent.click(screen.getByTestId('payroll-core-process_payroll'))
    expect(answersNow().serviceKeys).toContain('process_payroll')
    fireEvent.click(screen.getByTestId('payroll-core-self_processed'))
    expect(answersNow().serviceKeys).not.toContain('process_payroll')
    expect(answersNow().payrollSelfProcessed).toBe(true)
    // And a secondary service can still ride "they process their own" (3c).
    fireEvent.click(screen.getByTestId('payroll-service-Quarterly filings'))
    expect(answersNow().serviceKeys).toContain('payroll_quarterly_filings')
    expect(answersNow().payrollSelfProcessed).toBe(true)
  })

  it('a custom payroll service persists to payroll_services and rides payrollCustomServices (never serviceKeys - the quote cannot break)', async () => {
    const onAddOptionListValue = vi.fn(async (_l: string, name: string) => ({ id: 7, name }))
    render(
      <Harness
        initial={BASE}
        optionLists={{ payroll_services: [] }}
        onAddOptionListValue={onAddOptionListValue}
      />,
    )
    fireEvent.click(screen.getByTestId('payroll-core-process_payroll'))
    fireEvent.click(screen.getByTestId('payroll-service-add-open'))
    fireEvent.change(screen.getByLabelText('Type the payroll service'), { target: { value: 'School district PERS reporting' } })
    fireEvent.click(screen.getByTestId('payroll-service-add-submit'))
    await waitFor(() => expect(onAddOptionListValue).toHaveBeenCalledWith('payroll_services', 'School district PERS reporting'))
    await waitFor(() => expect(answersNow().payrollCustomServices).toEqual(['School district PERS reporting']))
    expect(answersNow().serviceKeys).not.toContain('School district PERS reporting')
  })

  it('Continue blocks with no core pick', () => {
    render(<Harness initial={BASE} optionLists={{ payroll_services: [] }} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByRole('alert').textContent).toContain('Pick who runs payroll first')
  })
})
