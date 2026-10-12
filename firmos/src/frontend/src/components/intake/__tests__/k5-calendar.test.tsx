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

describe('M2/D1: the simple month grid returns (10_10 00:36:33)', () => {
  it('the star math helpers keep their totals (the M4 billing calendar uses them)', () => {
    const weeks = weekStarCounts(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 8)
    // Aug 1 2026 is a Saturday: week 1 holds only Aug 1 (no Friday).
    expect(weeks).toEqual([0, 1, 1, 1, 1, 0])
    expect(monthStarCount(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 8)).toBe(4)
    expect(monthStarCount(FRIDAY_TASKS, FRIDAY_SCHEDULE, 2026, 9)).toBe(4)
  })

  it('the header carries the month star total on a flat grid - no toggle, no week rows, no rotation strip', () => {
    render(<RoutineCalendar tasks={FRIDAY_TASKS} entries={FRIDAY_SCHEDULE} anchorMonth={{ year: 2026, month: 8 }} />)
    expect(screen.getByTestId('cal-month-stars')).toHaveTextContent('4 ★')
    expect(screen.queryByTestId('busiest-toggle')).toBeNull()
    expect(screen.queryAllByTestId(/^cal-week-stars-/, { exact: false })).toHaveLength(0)
    expect(screen.queryByTestId('rotation-strip')).toBeNull()
    // The K8 flat grid: Friday the 7th plots with its dot.
    expect(screen.getByTestId('cal-day-7')).toBeInTheDocument()
  })

  it('the schedule stays marked proposed until the estimate is accepted (I3)', () => {
    render(<RoutineCalendar tasks={FRIDAY_TASKS} entries={FRIDAY_SCHEDULE} anchorMonth={{ year: 2026, month: 8 }} />)
    expect(screen.getByTestId('schedule-proposed-badge')).toHaveTextContent('Proposed')
  })

  // B8 (10_10 00:35:09): "Why does that say Feb… This is January." The header
  // month and the grid's day count now compute from ONE value - they can
  // never desync.
  it('B8: month_label_matches_grid - the header month always matches the grid day count', () => {
    const MONTHS = ['January', 'February', 'March']
    for (const m of [1, 2, 3]) {
      const { unmount } = render(
        <RoutineCalendar tasks={FRIDAY_TASKS} entries={FRIDAY_SCHEDULE} anchorMonth={{ year: 2026, month: m }} />,
      )
      expect(screen.getByTestId('routine-calendar')).toHaveTextContent(MONTHS[m - 1]!)
      const expectedDays = new Date(2026, m, 0).getDate()
      expect(screen.getAllByTestId(/^cal-day-\d+$/)).toHaveLength(expectedDays)
      unmount()
    }
  })
})

describe('M2/D1 (helpers kept for M4): busiestMonth still finds the peak month', () => {
  const MIXED_TASKS = [
    ...FRIDAY_TASKS,
    {
      key: 'eoy-tax-checklist',
      title: 'Year-end tax checklist',
      detail: null,
      assignee: 'manager' as const,
      defaultEntry: { bucket: 'annual' as const, order: 0, daysAfterPeriodEnd: 31 },
    },
  ]
  const MIXED_SCHEDULE = {
    ...FRIDAY_SCHEDULE,
    'eoy-tax-checklist': { bucket: 'annual' as const, order: 0, daysAfterPeriodEnd: 31 },
  }

  it('January (weekly Fridays + the annual) beats every other month', () => {
    expect(busiestMonth(MIXED_TASKS, MIXED_SCHEDULE, 2026)).toEqual({ month: 1, stars: expect.any(Number) })
    expect(busiestMonth(MIXED_TASKS, MIXED_SCHEDULE, 2026)!.stars).toBeGreaterThan(
      monthStarCount(MIXED_TASKS, MIXED_SCHEDULE, 2026, 3),
    )
  })
})
