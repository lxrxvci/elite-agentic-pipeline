import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import type { RoutineSchedule } from '@/shared/lib/routine-schedule'

import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * J3 (meeting #3, R1-R5): the "Routine order and frequency" screen - five
 * buckets, drag-and-drop ordering, per-bucket schedule controls, persisted
 * to form_data.routineSchedule. Rendered against the real registry question
 * through the QuestionScreen dispatcher.
 */

const q = findQuestion('recurring', 'routine-scheduler')!

function Harness({
  initial,
  onAdvance,
  question = q,
}: {
  initial: WizardAnswers
  onAdvance?: () => void
  question?: QuestionDef
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={question}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={() => {}}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const base: WizardAnswers = {
  legalName: 'Test Co',
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  bookkeepingStartDate: '2026-08-01',
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
const scheduleNow = (): RoutineSchedule => (answersNow().routineSchedule ?? {}) as RoutineSchedule

describe('J3 routine scheduler screen', () => {
  it('renders the five buckets with the standard four in Monthly, categorize first', () => {
    render(<Harness initial={base} />)
    for (const b of ['daily', 'weekly', 'monthly', 'quarterly', 'annual']) {
      expect(screen.getByTestId(`bucket-${b}`)).toBeInTheDocument()
    }
    const monthly = screen.getByTestId('bucket-monthly')
    const order = ['categorize_transactions', 'reconcile_accounts', 'client_questions', 'send_reports']
    for (const key of order) {
      expect(screen.getByTestId(`routine-card-${key}`)).toBeInTheDocument()
      expect(monthly.contains(screen.getByTestId(`routine-card-${key}`))).toBe(true)
    }
    // The bucket order on screen is the R2 working order.
    const rendered = within(monthly)
    expect(rendered).toEqual(order)
    expect(screen.getByTestId('bucket-count-monthly')).toHaveTextContent('4 tasks')
  })

  it('drag_moves_task_between_buckets_and_persists', () => {
    // The drag handler and this bucket picker commit the SAME move
    // (moveRoutineTask) - the accessible control stands in for the pointer
    // gesture here; dnd-kit pointer drags need real layout.
    render(<Harness initial={base} />)
    fireEvent.change(screen.getByTestId('move-bucket-categorize_transactions'), { target: { value: 'weekly' } })
    // The card moved, got the weekly bucket defaults, and the map persisted.
    expect(screen.getByTestId('bucket-weekly').contains(screen.getByTestId('routine-card-categorize_transactions'))).toBe(true)
    expect(screen.getByTestId('routine-card-categorize_transactions')).toHaveAttribute('data-bucket', 'weekly')
    expect(scheduleNow().categorize_transactions).toEqual({
      bucket: 'weekly',
      order: 0,
      weekdays: [5],
      everyNWeeks: 1,
    })
    // The monthly bucket renumbered.
    expect(scheduleNow().reconcile_accounts).toMatchObject({ bucket: 'monthly', order: 0 })
    expect(screen.getByTestId('bucket-count-monthly')).toHaveTextContent('3 tasks')
  })

  it('the up/down buttons reorder within a bucket', () => {
    render(<Harness initial={base} />)
    fireEvent.click(screen.getByTestId('move-down-categorize_transactions'))
    expect(scheduleNow().categorize_transactions).toMatchObject({ bucket: 'monthly', order: 1 })
    expect(scheduleNow().reconcile_accounts).toMatchObject({ bucket: 'monthly', order: 0 })
    // First card can't move up; last can't move down.
    expect(screen.getByTestId('move-up-reconcile_accounts')).toBeDisabled()
    fireEvent.click(screen.getByTestId('move-up-send_reports'))
    expect(scheduleNow().send_reports).toMatchObject({ order: 2 })
  })

  it('weekly controls: weekday pick + every-N-weeks persist', () => {
    render(<Harness initial={base} />)
    fireEvent.change(screen.getByTestId('move-bucket-categorize_transactions'), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByTestId('schedule-toggle-categorize_transactions'))
    fireEvent.click(screen.getByTestId('weekday-categorize_transactions-5'))
    const interval = screen.getByTestId('every-n-weeks-categorize_transactions')
    fireEvent.focus(interval)
    fireEvent.change(interval, { target: { value: '2' } })
    expect(scheduleNow().categorize_transactions).toEqual({
      bucket: 'weekly',
      order: 0,
      weekdays: [5],
      everyNWeeks: 2,
    })
    expect(screen.getByTestId('schedule-summary-categorize_transactions')).toHaveTextContent(
      'Every 2 weeks on Friday',
    )
  })

  it('monthly_defaults_to_close_tier_day', () => {
    // R5: the monthly cards default to the client's close tier day (10 here).
    render(<Harness initial={base} />)
    expect(screen.getByTestId('schedule-summary-categorize_transactions')).toHaveTextContent('Day 10 of the month')
    expect(screen.getByTestId('schedule-summary-client_questions')).toHaveTextContent('Day 25 of the month')
    // ...and a different tier repaints the default.
    render(<Harness initial={{ ...base, monthlyCloseTier: '5' }} />)
    const summaries = screen.getAllByTestId('schedule-summary-categorize_transactions')
    expect(summaries[1]).toHaveTextContent('Day 5 of the month')
  })

  it('annual controls: fiscal year-end plus days-following persist', () => {
    render(<Harness initial={base} />)
    fireEvent.change(screen.getByTestId('move-bucket-send_reports'), { target: { value: 'annual' } })
    fireEvent.click(screen.getByTestId('schedule-toggle-send_reports'))
    fireEvent.click(screen.getByTestId('yearend-fiscal-send_reports'))
    const fiscal = screen.getByTestId('fiscal-yearend-send_reports')
    fireEvent.change(fiscal, { target: { value: '0630' } })
    const days = screen.getByTestId('days-after-send_reports')
    fireEvent.focus(days)
    fireEvent.change(days, { target: { value: '45' } })
    expect(scheduleNow().send_reports).toEqual({
      bucket: 'annual',
      // K5 (E9): the EOY tax checklist is annual order 0 now; this lands 1.
      order: 1,
      fiscalYearEnd: '06-30',
      daysAfterPeriodEnd: 45,
    })
    expect(screen.getByTestId('schedule-summary-send_reports')).toHaveTextContent(
      '45 days after the fiscal year ends (6/30)',
    )
  })

  it('removing a standard card confirms first, then persists a B21 exclusion (L1/H3)', () => {
    render(<Harness initial={base} />)
    fireEvent.click(screen.getByTestId('remove-client_questions'))
    // L1 (H3/H4, 10_06 00:41:21): the X confirms before anything removes -
    // "it goes poof and that can't happen."
    expect(screen.getByTestId('confirm-delete-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    // The card is gone, the key leaves the map, and the exclusion persists -
    // the card never derives again (the J3 form of the B21 unselect).
    expect(screen.queryByTestId('routine-card-client_questions')).not.toBeInTheDocument()
    expect(scheduleNow().client_questions).toBeUndefined()
    expect(answersNow().excludedDefaultRules).toEqual(['client_questions'])
    expect(scheduleNow().categorize_transactions).toBeDefined()
    // L1 (H2): answer-derived cards are removable TOO (with confirm) - the
    // removal syncs back to the answers.
    render(<Harness initial={{ ...base, hasPayroll: true, payrollFrequency: 'weekly' }} />)
    expect(screen.getByTestId('remove-payroll-handling')).toBeInTheDocument()
  })

  it('answer-derived cards render: payroll, behavior seeds, bills, custom rules', () => {
    render(
      <Harness
        initial={{
          ...base,
          hasPayroll: true,
          payrollFrequency: 'biweekly',
          payrollProvider: 'Gusto',
          personalCardForBusiness: true,
          recordBills: true,
          payBills: true,
          billPayLocations: ['Vendor websites'],
          customRecurringRules: [{ title: 'Weekly deposit review', scheduleType: 'weekly' }],
        }}
      />,
    )
    expect(screen.getByTestId('routine-card-payroll-handling')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-summary-payroll-handling')).toHaveTextContent('Every 2 weeks on Friday')
    expect(screen.getByTestId('routine-card-personal-card')).toBeInTheDocument()
    expect(screen.getByTestId('routine-card-record-bills')).toBeInTheDocument()
    expect(screen.getByTestId('routine-card-pay-bills')).toBeInTheDocument()
    expect(screen.getByTestId('routine-card-custom:Weekly deposit review')).toBeInTheDocument()
  })

  it('a persisted schedule wins on resume; stale keys never render', () => {
    render(
      <Harness
        initial={{
          ...base,
          routineSchedule: {
            send_reports: { bucket: 'quarterly', order: 0, daysAfterPeriodEnd: 10 },
            'ghost-task': { bucket: 'daily', order: 0, weekdays: [1] },
          },
        }}
      />,
    )
    expect(screen.getByTestId('bucket-quarterly').contains(screen.getByTestId('routine-card-send_reports'))).toBe(true)
    expect(screen.queryByTestId('routine-card-ghost-task')).not.toBeInTheDocument()
    // The other three standards render from their derived defaults.
    expect(screen.getByTestId('routine-card-categorize_transactions')).toBeInTheDocument()
  })

  it('Continue blocks a day-driven card with no days, else advances with the map', () => {
    const onAdvance = vi.fn()
    render(<Harness initial={base} onAdvance={onAdvance} />)
    fireEvent.change(screen.getByTestId('move-bucket-categorize_transactions'), { target: { value: 'daily' } })
    fireEvent.click(screen.getByTestId('schedule-toggle-categorize_transactions'))
    for (const d of [1, 2, 3, 4, 5]) {
      fireEvent.click(screen.getByTestId(`weekday-categorize_transactions-${d}`))
    }
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one day of the week')
    expect(onAdvance).not.toHaveBeenCalled()
    // Re-pick a day and Continue commits + advances.
    fireEvent.click(screen.getByTestId('weekday-categorize_transactions-3'))
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(scheduleNow().categorize_transactions).toMatchObject({ bucket: 'daily', weekdays: [3] })
  })
})

/** The card keys inside a bucket section, in render order. */
function within(bucket: HTMLElement): string[] {
  return Array.from(bucket.querySelectorAll('[data-testid^="routine-card-"]')).map((el) =>
    el.getAttribute('data-testid')!.slice('routine-card-'.length),
  )
}
