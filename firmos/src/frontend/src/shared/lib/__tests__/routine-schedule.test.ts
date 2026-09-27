import { describe, expect, it } from 'vitest'

import {
  defaultFieldsForBucket,
  moveRoutineTask,
  parseFiscalYearEnd,
  planRoutineSeeds,
  resolveRoutineEntries,
  routineBucketOrder,
  routineEntrySummary,
  routineEntryToRuleSchedule,
  sanitizeRoutineEntry,
  type RoutineSchedule,
  type RoutineScheduleEntry,
  type RoutineTaskDef,
} from '../routine-schedule'

/**
 * J3 (meeting #3, R1-R5): the "Routine order and frequency" schedule model -
 * bucket mapping onto the §6.4 engine fields, form_data sanitization, the
 * move semantics drag-and-drop and the keyboard controls share, and the
 * conversion plan.
 */

const def = (partial: Partial<RoutineTaskDef> & Pick<RoutineTaskDef, 'key' | 'defaultEntry'>): RoutineTaskDef => ({
  title: partial.key,
  detail: null,
  assignee: 'bookkeeper',
  ...partial,
})

describe('routineEntryToRuleSchedule', () => {
  it('monthly_defaults_to_close_tier_day', () => {
    // R4/R5: a monthly card with no explicit day defaults to the tier day.
    expect(routineEntryToRuleSchedule({ bucket: 'monthly', order: 0 }, { tierDay: 10 })).toEqual({
      scheduleType: 'monthly',
      daysOfWeek: null,
      dayOfMonth: 10,
      anchorMonth: null,
      weekInterval: null,
    })
    expect(
      routineEntryToRuleSchedule({ bucket: 'monthly', order: 0, dayOfMonth: 22 }, { tierDay: 10 }).dayOfMonth,
    ).toBe(22)
  })

  it('weekly maps the weekday plus the every-N-weeks interval', () => {
    expect(
      routineEntryToRuleSchedule({ bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 2 }, { tierDay: 15 }),
    ).toEqual({
      scheduleType: 'weekly',
      daysOfWeek: '5',
      dayOfMonth: null,
      anchorMonth: null,
      weekInterval: 2,
    })
    // Every week stays null so plain weekly rows stay clean.
    expect(
      routineEntryToRuleSchedule({ bucket: 'weekly', order: 0, weekdays: [1], everyNWeeks: 1 }, { tierDay: 15 })
        .weekInterval,
    ).toBeNull()
  })

  it('daily with a weekday subset rides the weekly engine; all seven = daily', () => {
    expect(
      routineEntryToRuleSchedule({ bucket: 'daily', order: 0, weekdays: [1, 3, 5] }, { tierDay: 15 }),
    ).toEqual({
      scheduleType: 'weekly',
      daysOfWeek: '1,3,5',
      dayOfMonth: null,
      anchorMonth: null,
      weekInterval: null,
    })
    expect(
      routineEntryToRuleSchedule({ bucket: 'daily', order: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }, { tierDay: 15 })
        .scheduleType,
    ).toBe('daily')
  })

  it('quarterly lands N days after the calendar-quarter end (R4)', () => {
    // Cadence months Jan/Apr/Jul/Oct, day 10 -> ten days after each quarter ends.
    expect(
      routineEntryToRuleSchedule({ bucket: 'quarterly', order: 0, daysAfterPeriodEnd: 10 }, { tierDay: 15 }),
    ).toEqual({
      scheduleType: 'quarterly',
      daysOfWeek: null,
      dayOfMonth: 10,
      anchorMonth: 1,
      weekInterval: null,
    })
  })

  it('annual_fiscal_yearend_plus_45_days', () => {
    // R4: fiscal June 30 + 45 days = August 14 -> annual, anchored on August.
    expect(
      routineEntryToRuleSchedule(
        { bucket: 'annual', order: 0, fiscalYearEnd: '06-30', daysAfterPeriodEnd: 45 },
        { tierDay: 15 },
      ),
    ).toEqual({
      scheduleType: 'annual',
      daysOfWeek: null,
      dayOfMonth: 14,
      anchorMonth: 8,
      weekInterval: null,
    })
    // Calendar year-end (Dec 31) + 10 days = January 10.
    expect(
      routineEntryToRuleSchedule(
        { bucket: 'annual', order: 0, fiscalYearEnd: null, daysAfterPeriodEnd: 10 },
        { tierDay: 15 },
      ),
    ).toMatchObject({ scheduleType: 'annual', anchorMonth: 1, dayOfMonth: 10 })
    // The tier day is the default days-following.
    expect(
      routineEntryToRuleSchedule({ bucket: 'annual', order: 0, fiscalYearEnd: null }, { tierDay: 5 }),
    ).toMatchObject({ anchorMonth: 1, dayOfMonth: 5 })
  })
})

describe('sanitizeRoutineEntry (form_data is user-controlled JSON)', () => {
  const fallback: RoutineScheduleEntry = { bucket: 'weekly', order: 3, weekdays: [5], everyNWeeks: 2 }

  it('clamps junk fields onto the derived default', () => {
    expect(sanitizeRoutineEntry('garbage', fallback)).toEqual(fallback)
    expect(sanitizeRoutineEntry({ bucket: 'weekly', order: 9, weekdays: [9, 'x', 5, 5], everyNWeeks: 0 }, fallback)).toEqual({
      bucket: 'weekly',
      order: 9,
      weekdays: [5],
      everyNWeeks: 2, // out of range -> the default
    })
    // An unknown bucket resets the whole entry to the task default.
    expect(sanitizeRoutineEntry({ bucket: 'hourly', order: 1 }, fallback)).toEqual(fallback)
  })

  it('an empty weekday set falls back instead of flipping daily to every day', () => {
    const dailyFallback: RoutineScheduleEntry = { bucket: 'daily', order: 0, weekdays: [1, 2, 3, 4, 5] }
    expect(sanitizeRoutineEntry({ bucket: 'daily', order: 0, weekdays: [] }, dailyFallback).weekdays).toEqual([
      1, 2, 3, 4, 5,
    ])
  })

  it('keepSourceSchedule inherits the default and an explicit false clears it', () => {
    const keepFallback: RoutineScheduleEntry = { bucket: 'annual', order: 0, keepSourceSchedule: true }
    expect(sanitizeRoutineEntry({ bucket: 'annual', order: 0 }, keepFallback).keepSourceSchedule).toBe(true)
    expect(
      sanitizeRoutineEntry({ bucket: 'annual', order: 0, keepSourceSchedule: false }, keepFallback)
        .keepSourceSchedule,
    ).toBeUndefined()
  })

  it('fiscal year-end validates as a real MM-DD date', () => {
    expect(parseFiscalYearEnd('06-30')).toEqual({ month: 6, day: 30 })
    expect(parseFiscalYearEnd('02-29')).toEqual({ month: 2, day: 29 }) // leap reference year
    expect(parseFiscalYearEnd('13-01')).toBeNull()
    expect(parseFiscalYearEnd('02-30')).toBeNull()
    expect(parseFiscalYearEnd('June 30')).toBeNull()
    expect(
      sanitizeRoutineEntry(
        { bucket: 'annual', order: 0, fiscalYearEnd: '99-99' },
        { bucket: 'annual', order: 0, fiscalYearEnd: null },
      ).fiscalYearEnd,
    ).toBeNull()
  })
})

describe('moveRoutineTask (shared by drag-and-drop and the keyboard controls)', () => {
  const entries: RoutineSchedule = {
    a: { bucket: 'monthly', order: 0, dayOfMonth: 10 },
    b: { bucket: 'monthly', order: 1, dayOfMonth: 10 },
    c: { bucket: 'monthly', order: 2, dayOfMonth: 25 },
    d: { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 },
  }

  it('reorders within a bucket and keeps every schedule field', () => {
    const next = moveRoutineTask(entries, 'a', 'monthly', 2, 15)
    expect(next.a).toEqual({ bucket: 'monthly', order: 2, dayOfMonth: 10 })
    expect(next.b?.order).toBe(0)
    expect(next.c?.order).toBe(1)
    expect(next.d).toEqual(entries.d)
  })

  it('drag_moves_task_between_buckets_and_persists', () => {
    // The exact move the drag handler (and the bucket picker) commits:
    // cross-bucket moves reset the schedule to the bucket defaults and the
    // card lands at the target index; source orders renumber.
    const next = moveRoutineTask(entries, 'c', 'weekly', 0, 15)
    expect(next.c).toEqual({ bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 })
    expect(next.d).toEqual({ bucket: 'weekly', order: 1, weekdays: [5], everyNWeeks: 1 })
    expect(next.a?.order).toBe(0)
    expect(next.b?.order).toBe(1)
    // keepSourceSchedule never survives a bucket move.
    const kept: RoutineSchedule = {
      s: { bucket: 'annual', order: 0, keepSourceSchedule: true },
      m: { bucket: 'monthly', order: 0, dayOfMonth: 10 },
    }
    expect(moveRoutineTask(kept, 's', 'monthly', 1, 15).s).toEqual({
      bucket: 'monthly',
      order: 1,
      dayOfMonth: 15,
    })
  })

  it('clamps the target index into the bucket', () => {
    const next = moveRoutineTask(entries, 'd', 'monthly', 999, 15)
    expect(next.d?.bucket).toBe('monthly')
    expect(next.d?.order).toBe(3)
  })
})

describe('planRoutineSeeds (the conversion plan)', () => {
  const tasks: RoutineTaskDef[] = [
    def({ key: 'categorize', defaultEntry: { bucket: 'monthly', order: 0, dayOfMonth: 10 } }),
    def({ key: 'reconcile', defaultEntry: { bucket: 'monthly', order: 1, dayOfMonth: 10 } }),
    def({
      key: 'semi',
      defaultEntry: { bucket: 'annual', order: 0, keepSourceSchedule: true },
      sourceSchedule: { scheduleType: 'semi_annual', anchorMonth: 1, dayOfMonth: 10 },
    }),
    def({
      key: 'custom:X',
      title: 'X',
      defaultEntry: { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 2 },
      isCustom: true,
      subtasks: ['Pull the report'],
      isBillable: true,
      unitPrice: '75.00',
    }),
  ]

  it('every scheduled entry becomes a rule with the mapped cadence', () => {
    const schedule: RoutineSchedule = {
      categorize: { bucket: 'monthly', order: 0 },
      reconcile: { bucket: 'weekly', order: 0, weekdays: [2], everyNWeeks: 3 },
      'custom:X': { bucket: 'weekly', order: 1, weekdays: [5], everyNWeeks: 2 },
    }
    const seeds = planRoutineSeeds(tasks, schedule, { tierDay: 10 })
    expect(seeds.map((s) => s.key)).toEqual(['categorize', 'reconcile', 'custom:X'])
    expect(seeds[0]).toMatchObject({ scheduleType: 'monthly', dayOfMonth: 10 })
    expect(seeds[1]).toMatchObject({ scheduleType: 'weekly', daysOfWeek: '2', weekInterval: 3 })
    // The custom rule keeps its checklist + billing passthrough.
    expect(seeds[2]).toMatchObject({
      isCustom: true,
      subtasks: ['Pull the report'],
      isBillable: true,
      unitPrice: '75.00',
      weekInterval: 2,
    })
  })

  it('keys absent from the map were removed on the screen and never seed', () => {
    const seeds = planRoutineSeeds(tasks, { categorize: { bucket: 'monthly', order: 0 } }, { tierDay: 10 })
    expect(seeds.map((s) => s.key)).toEqual(['categorize'])
  })

  it('keepSourceSchedule copies the source cadence verbatim', () => {
    const seeds = planRoutineSeeds(
      tasks,
      { semi: { bucket: 'annual', order: 0, keepSourceSchedule: true } },
      { tierDay: 15 },
    )
    expect(seeds[0]).toMatchObject({
      scheduleType: 'semi_annual',
      anchorMonth: 1,
      dayOfMonth: 10,
      weekInterval: null,
    })
  })

  it('stale keys the answers no longer derive are ignored', () => {
    const seeds = planRoutineSeeds(
      tasks,
      {
        categorize: { bucket: 'monthly', order: 0 },
        'ghost-task': { bucket: 'daily', order: 0, weekdays: [1] },
      },
      { tierDay: 10 },
    )
    expect(seeds.map((s) => s.key)).toEqual(['categorize'])
  })
})

describe('resolveRoutineEntries + routineBucketOrder + summaries', () => {
  const tasks: RoutineTaskDef[] = [
    def({ key: 'categorize', defaultEntry: { bucket: 'monthly', order: 0, dayOfMonth: 10 } }),
    def({ key: 'reconcile', defaultEntry: { bucket: 'monthly', order: 1, dayOfMonth: 10 } }),
    def({ key: 'reports', defaultEntry: { bucket: 'monthly', order: 2, dayOfMonth: 10 } }),
  ]

  it('stored entries win over defaults; missing tasks get their default', () => {
    const entries = resolveRoutineEntries(tasks, {
      reconcile: { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 2 },
    })
    expect(entries.reconcile).toEqual({ bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 2 })
    expect(entries.categorize).toEqual({ bucket: 'monthly', order: 0, dayOfMonth: 10 })
    const order = routineBucketOrder(tasks, entries)
    expect(order.weekly).toEqual(['reconcile'])
    expect(order.monthly).toEqual(['categorize', 'reports'])
  })

  it('the card summary speaks plainly', () => {
    expect(routineEntrySummary({ bucket: 'daily', order: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day')
    expect(routineEntrySummary({ bucket: 'daily', order: 0, weekdays: [1, 3, 5] })).toBe('Mon, Wed, Fri')
    expect(routineEntrySummary({ bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 })).toBe('Fridays')
    expect(routineEntrySummary({ bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 2 })).toBe(
      'Every 2 weeks on Friday',
    )
    expect(routineEntrySummary({ bucket: 'monthly', order: 0, dayOfMonth: 10 })).toBe('Day 10 of the month')
    expect(routineEntrySummary({ bucket: 'quarterly', order: 0, daysAfterPeriodEnd: 10 })).toBe(
      '10 days after the quarter ends',
    )
    expect(
      routineEntrySummary({ bucket: 'annual', order: 0, fiscalYearEnd: '06-30', daysAfterPeriodEnd: 45 }),
    ).toBe('45 days after the fiscal year ends (6/30)')
    expect(routineEntrySummary({ bucket: 'annual', order: 0, fiscalYearEnd: null, daysAfterPeriodEnd: 10 })).toBe(
      '10 days after the year ends (Dec 31)',
    )
  })

  it('defaultFieldsForBucket: monthly and the period buckets default to the tier day', () => {
    expect(defaultFieldsForBucket('monthly', 10)).toEqual({ dayOfMonth: 10 })
    expect(defaultFieldsForBucket('quarterly', 10)).toEqual({ daysAfterPeriodEnd: 10 })
    expect(defaultFieldsForBucket('annual', 10)).toEqual({ daysAfterPeriodEnd: 10, fiscalYearEnd: null })
    expect(defaultFieldsForBucket('daily', 10)).toEqual({ weekdays: [1, 2, 3, 4, 5] })
    expect(defaultFieldsForBucket('weekly', 10)).toEqual({ weekdays: [5], everyNWeeks: 1 })
  })
})
