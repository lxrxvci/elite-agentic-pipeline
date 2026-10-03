import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { deriveRoutineTasks, type WizardAnswers } from '../registry'
import { resolveRoutineEntries } from '@/shared/lib/routine-schedule'
import { plotMonth, RoutineCalendar, BUCKET_DOT } from '../routine-calendar'

/**
 * K5 (E1, 09_30 00:50:15): the scheduling calendar - tasks plotted on a
 * month grid, color-coded by cadence bucket.
 */

const answers: WizardAnswers = {
  legalName: 'X Co',
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  bookkeepingStartDate: '2026-08-01',
  recordDeposits: true, // weekly Fridays
  recordBills: true, // weekly Fridays
} as WizardAnswers

describe('routine calendar (E1)', () => {
  it('calendar_marks_each_task: monthly tier day, weekly Fridays, annual January', () => {
    const tasks = deriveRoutineTasks(answers)
    const entries = resolveRoutineEntries(tasks, undefined)
    // August 2026: Aug 1 is a Saturday; Fridays are 7/14/21/28.
    const plot = plotMonth(tasks, entries, 2026, 8)

    // Monthly standards land on the tier day (10th).
    expect(plot.get(10)).toContain('monthly')
    // Weekly tasks (record deposits, record bills) on every Friday.
    for (const friday of [7, 14, 21, 28]) {
      expect(plot.get(friday)).toContain('weekly')
    }
    // Client questions keeps its 25th touchpoint.
    expect(plot.get(25)).toContain('monthly')
    // A plain Wednesday (12th) has nothing.
    expect(plot.get(12)).toBeUndefined()
    // The EOY checklist (annual, calendar year-end) plots in January.
    const jan = plotMonth(tasks, entries, 2027, 1)
    expect(jan.get(31)).toContain('annual')
  })

  it('renders the grid with Jason\'s palette + legend', () => {
    const tasks = deriveRoutineTasks(answers)
    const entries = resolveRoutineEntries(tasks, undefined)
    render(<RoutineCalendar tasks={tasks} entries={entries} />)
    expect(screen.getByTestId('routine-calendar')).toBeInTheDocument()
    for (const b of ['daily', 'weekly', 'monthly', 'quarterly', 'annual'] as const) {
      expect(screen.getByTestId(`cal-legend-${b}`)).toBeInTheDocument()
    }
    // Jason's colors: daily green, weekly yellow, monthly orange.
    expect(BUCKET_DOT.daily).toContain('emerald')
    expect(BUCKET_DOT.weekly).toContain('amber')
    expect(BUCKET_DOT.monthly).toContain('orange')
  })

  it('scheduler cards name the responsible seat (E8)', () => {
    const tasks = deriveRoutineTasks(answers)
    const byKey = new Map(tasks.map((t) => [t.key, t]))
    expect(byKey.get('client_questions')?.assignee).toBe('manager')
    expect(byKey.get('eoy-tax-checklist')?.assignee).toBe('manager')
    expect(byKey.get('categorize_transactions')?.assignee).toBe('bookkeeper')
    expect(byKey.get('record-deposits')?.assignee).toBe('bookkeeper')
  })
})
