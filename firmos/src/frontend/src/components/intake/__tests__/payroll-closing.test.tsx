import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { closeTierDay, deriveRoutineTasks, findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

function ClosingQuestion() {
  const [answers, setAnswers] = useState<WizardAnswers>({ bookkeepingFrequency: 'annual' })
  const q = findQuestion('reporting', 'close-tier')!
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={() => {}}
        onPickOption={(value) => setAnswers((current) => ({ ...current, ...q.apply(current, value) }))}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

describe('payroll and closing schedules', () => {
  it('collects a custom offset inline and applies it to annual scheduling', () => {
    render(<ClosingQuestion />)
    fireEvent.click(screen.getByRole('combobox', { name: 'When should the close be ready?' }))
    fireEvent.click(screen.getByTestId('option-other'))
    expect(screen.getByTestId('inline-followup-close-deadline-days')).toBeInTheDocument()
    expect(screen.getAllByTestId('continue')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByRole('alert')).toHaveTextContent('Days after period end is required')
    fireEvent.change(screen.getByLabelText('Days after period end'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('continue'))
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers).toMatchObject({ monthlyCloseTier: '15', closeDeadlineChoice: 'other', closeDeadlineDaysAfterEnd: 20 })
    expect(closeTierDay(answers)).toBe(20)
    const reports = deriveRoutineTasks(answers).find((task) => task.key === 'send_reports')!
    expect(reports.defaultEntry.daysAfterPeriodEnd).toBe(20)
  })

  it('keeps semi-annual cadence and uses the numeric close offset', () => {
    const answers: WizardAnswers = {
      bookkeepingFrequency: 'semi_annual',
      monthlyCloseTier: '15',
      closeDeadlineChoice: 'other',
      closeDeadlineDaysAfterEnd: 20,
    }
    const task = deriveRoutineTasks(answers).find((candidate) => candidate.key === 'send_reports')!
    expect(task.defaultEntry.daysAfterPeriodEnd).toBe(20)
    expect(task.sourceSchedule).toMatchObject({ scheduleType: 'semi_annual', dayOfMonth: 20 })
  })

  it('retains the standard pricing tier while allowing a custom scheduling day', () => {
    const answers: WizardAnswers = {
      engagementType: 'bookkeeping',
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      closeDeadlineChoice: '10',
      closeDeadlineDaysAfterEnd: 10,
    }
    expect(closeTierDay(answers)).toBe(10)
    expect(deriveRoutineTasks(answers).find((task) => task.key === 'send_reports')?.defaultEntry.dayOfMonth).toBe(10)
  })
})
