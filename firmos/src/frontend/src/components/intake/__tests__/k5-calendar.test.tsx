import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { deriveRoutineTasks, type WizardAnswers } from '../registry'
import { resolveRoutineEntries } from '@/shared/lib/routine-schedule'
import {
  busiestMonth,
  BUCKET_DOT,
  monthStarCount,
  plotMonth,
  RoutineCalendar,
  weekStarCounts,
} from '../routine-calendar'

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

/**
 * L6 (10_06): the star metric - one star = one scheduled task occurrence.
 * Weekly row totals + the monthly header total (I1, 00:53:44), the
 * busiest-month toggle and the quarterly/annual rotation strip (I2,
 * 00:47:52), and the proposed-until-accepted badge (I3, 00:58:22).
 */

const FRIDAY_TASKS = [
  {
    key: 'record-deposits',
    title: 'Record deposits',
    detail: null,
    assignee: 'bookkeeper' as const,
    defaultEntry: { bucket: 'weekly' as const, order: 0, weekdays: [5] },
  },
]
const FRIDAY_SCHEDULE = { 'record-deposits': { bucket: 'weekly' as const, order: 0, weekdays: [5] } }

describe('L6/I1: weekly_and_monthly_star_totals_render (10_06 00:53:44)', () => {
  it('August 2026 (4 Fridays) totals 4 stars, split per grid week', () => {
    const weeks = weekStarCounts(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 8)
    // Aug 1 2026 is a Saturday: week 1 holds only Aug 1 (no Friday).
    expect(weeks).toEqual([0, 1, 1, 1, 1, 0])
    expect(weekStarCounts(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 8).reduce((a, n) => a + n, 0)).toBe(4)
    expect(monthStarCount(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 8)).toBe(4)
    // September 2026 Fridays are the 4th, 11th, 18th, 25th - 4 stars too.
    expect(monthStarCount(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 9)).toBe(4)
  })

  it('the calendar renders the monthly header total and the week row totals', () => {
    render(<RoutineCalendar tasks={FRIDAY_TASKS} entries={FRIDAY_SCHEDULE} anchorMonth={{ year: 2026, month: 8 }} />)
    expect(screen.getByTestId('cal-month-stars')).toHaveTextContent('4 ★')
    expect(screen.getByTestId('cal-week-stars-2')).toHaveTextContent('1 ★')
    expect(screen.getByTestId('cal-week-stars-1')).toHaveTextContent('0 ★')
  })

  it('the schedule is marked proposed until the estimate is accepted (I3)', () => {
    render(<RoutineCalendar tasks={FRIDAY_TASKS} entries={FRIDAY_SCHEDULE} anchorMonth={{ year: 2026, month: 8 }} />)
    expect(screen.getByTestId('schedule-proposed-badge')).toHaveTextContent('Proposed')
  })
})

describe('L6/I2: busiest-month toggle + the rotation strip (10_06 00:47:52)', () => {
  const MIXED_TASKS = [
    ...FRIDAY_TASKS,
    {
      key: 'eoy-tax-checklist',
      title: 'Year-end tax checklist',
      detail: null,
      assignee: 'manager' as const,
      defaultEntry: { bucket: 'annual' as const, order: 0, daysAfterPeriodEnd: 31 },
    },
    {
      key: 'specialty:1',
      title: 'Oregon special report',
      detail: null,
      assignee: 'bookkeeper' as const,
      defaultEntry: { bucket: 'quarterly' as const, order: 1, daysAfterPeriodEnd: 10 },
    },
  ]
  const MIXED_SCHEDULE = {
    ...FRIDAY_SCHEDULE,
    'eoy-tax-checklist': { bucket: 'annual' as const, order: 0, daysAfterPeriodEnd: 31 },
    'specialty:1': { bucket: 'quarterly' as const, order: 1, daysAfterPeriodEnd: 10 },
  }

  it('the busiest-month toggle swaps to the peak month and back', () => {
    // January hosts the annual (1) + the quarterly (1) + 4-5 Fridays.
    const busiest = busiestMonth(MIXED_TASKS, MIXED_SCHEDULE, 2026)
    expect(busiest).not.toBeNull()
    render(<RoutineCalendar tasks={MIXED_TASKS} entries={MIXED_SCHEDULE} anchorMonth={{ year: 2026, month: 3 }} />)
    const before = screen.getByTestId('cal-month-stars').textContent
    fireEvent.click(screen.getByTestId('busiest-toggle-busiest'))
    expect(screen.getByTestId('cal-month-stars').textContent).not.toBe(before)
    // The header names the peak month.
    expect(screen.getByTestId('routine-calendar')).toHaveTextContent(
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][busiest!.month - 1]!,
    )
    fireEvent.click(screen.getByTestId('busiest-toggle-current'))
    expect(screen.getByTestId('cal-month-stars').textContent).toBe(before)
  })

  it('quarterly and annual tasks stay visible on the rotation strip every month', () => {
    render(<RoutineCalendar tasks={MIXED_TASKS} entries={MIXED_SCHEDULE} anchorMonth={{ year: 2026, month: 3 }} />)
    const strip = screen.getByTestId('rotation-strip')
    expect(within(strip).getByTestId('rotation-eoy-tax-checklist')).toHaveTextContent('Annual · lands each January')
    expect(within(strip).getByTestId('rotation-specialty:1')).toHaveTextContent('Quarterly · lands the 10th of Jan, Apr, Jul, Oct')
    // March is no host month: neither plots in the grid.
    expect(screen.queryByTestId('cal-day-31')?.getAttribute('aria-label') ?? '').not.toContain('checklist')
  })
})
