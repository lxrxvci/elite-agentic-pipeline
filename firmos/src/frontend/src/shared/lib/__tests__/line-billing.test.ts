import { describe, expect, it } from 'vitest'

import {
  billingAmountForPeriod,
  calcAmountForMonth,
  defaultLineBilling,
  occurrenceMathLabel,
  resolveLineBilling,
  type LineBillingConfig,
} from '../line-billing'

/**
 * M3 (10_10): Jason's five billing scenarios from the call, verbatim -
 * "Billing frequency is different than frequency" (01:03:54). Amounts are
 * actual counts per period; averaging is rejected (01:09:53).
 */

const WEEKLY_25: LineBillingConfig = {
  calcFrequency: 'weekly',
  billingFrequency: 'monthly',
  calcWeekdays: [5],
}

describe('M3/A2: weekly_calc_counts_fridays_per_month (10_10 00:56:00)', () => {
  it('$25/Friday billed monthly: October has 5 Fridays ($125), November 4 ($100)', () => {
    expect(billingAmountForPeriod(WEEKLY_25, 25, 1, 'monthly', { year: 2026, month: 10 })).toBe(125)
    expect(billingAmountForPeriod(WEEKLY_25, 25, 1, 'monthly', { year: 2026, month: 11 })).toBe(100)
  })

  it('the same line billed weekly is $25 every week (each selected weekday once)', () => {
    expect(billingAmountForPeriod({ ...WEEKLY_25, billingFrequency: 'weekly' }, 25, 1, 'weekly', { year: 2026, month: 10 })).toBe(25)
  })

  it('billed quarterly it counts the quarter\'s Fridays; annually the year\'s', () => {
    // Oct(5) + Nov(4) + Dec(4) 2026 = 13 Fridays.
    expect(billingAmountForPeriod({ ...WEEKLY_25, billingFrequency: 'quarterly' }, 25, 1, 'quarterly', { year: 2026, month: 10 })).toBe(
      13 * 25,
    )
  })

  it('the estimate line shows the calc-cadence amount for the estimate month', () => {
    expect(calcAmountForMonth(WEEKLY_25, 25, 1, 2026, 10)).toBe(125)
    expect(calcAmountForMonth(WEEKLY_25, 25, 1, 2026, 11)).toBe(100)
  })
})

describe('M3/A5: daily_calc_counts_each_selected_weekday (10_10 01:14:09)', () => {
  it('$25/day with Mon/Wed/Fri: October = 4M+4W+5F = $325', () => {
    const cfg: LineBillingConfig = {
      calcFrequency: 'daily',
      billingFrequency: 'monthly',
      calcWeekdays: [1, 3, 5],
    }
    expect(billingAmountForPeriod(cfg, 25, 1, 'monthly', { year: 2026, month: 10 })).toBe(325)
    // November 2026: 5M + 4W + 4F = 13 days - $325 too.
    expect(billingAmountForPeriod(cfg, 25, 1, 'monthly', { year: 2026, month: 11 })).toBe(325)
  })
})

describe('M3/A3: flat_monthly_mode_for_weekly_task (10_10 01:00:03)', () => {
  it('a weekly task calculated flat-monthly is the flat amount every month - Fridays irrelevant', () => {
    const cfg: LineBillingConfig = {
      calcFrequency: 'weekly',
      billingFrequency: 'monthly',
      calcWeekdays: [5],
      flatMonthly: true,
    }
    expect(calcAmountForMonth(cfg, 300, 1, 2026, 10)).toBe(300)
    expect(billingAmountForPeriod(cfg, 300, 1, 'monthly', { year: 2026, month: 11 })).toBe(300)
  })
})

describe('M3: cross-frequency proration (10_10 01:04:37)', () => {
  it('$25/month billed annually = $300 once (counts months)', () => {
    const cfg: LineBillingConfig = { calcFrequency: 'monthly', billingFrequency: 'annual' }
    expect(billingAmountForPeriod(cfg, 25, 1, 'annual', { year: 2026, month: 1 })).toBe(300)
  })

  it('$600/year billed monthly = $50 each month (divides, never averages past the rule)', () => {
    const cfg: LineBillingConfig = { calcFrequency: 'annual', billingFrequency: 'monthly' }
    expect(billingAmountForPeriod(cfg, 600, 1, 'monthly', { year: 2026, month: 5 })).toBe(50)
  })
})

describe('M3/A10+A13: defaults (00:57:44 + 01:01:27)', () => {
  it('defaults follow the line\'s natural cadence and the closing frequency', () => {
    // Annual lines: calc annual, bill annually (L4's bill_month preserved).
    expect(defaultLineBilling({ bucket: 'annual', closingFrequency: 'monthly', billMonth: 1 })).toEqual({
      calcFrequency: 'annual',
      billingFrequency: 'annual',
      billMonth: 1,
    })
    // Weekly-scheduled: calc weekly (Fridays default), billed at the closing frequency.
    expect(defaultLineBilling({ bucket: 'weekly', closingFrequency: 'monthly', scheduleWeekdays: [5] })).toEqual({
      calcFrequency: 'weekly',
      billingFrequency: 'monthly',
      calcWeekdays: [5],
    })
    // Monthly: calc monthly, billed at the closing frequency (quarterly close here).
    expect(defaultLineBilling({ bucket: 'monthly', closingFrequency: 'quarterly' })).toEqual({
      calcFrequency: 'monthly',
      billingFrequency: 'quarterly',
    })
    // Unknown closing frequency falls back to monthly.
    expect(defaultLineBilling({ bucket: 'monthly', closingFrequency: 'yearly' })).toEqual({
      calcFrequency: 'monthly',
      billingFrequency: 'monthly',
    })
  })

  it('overrides win field-by-field; invalid values are ignored', () => {
    const defaults = defaultLineBilling({ bucket: 'weekly', closingFrequency: 'monthly', scheduleWeekdays: [5] })
    expect(resolveLineBilling(defaults, { billingFrequency: 'weekly' })).toMatchObject({
      calcFrequency: 'weekly',
      billingFrequency: 'weekly',
    })
    expect(resolveLineBilling(defaults, { calcFrequency: 'fortnightly' as never }).calcFrequency).toBe('weekly')
    expect(resolveLineBilling(defaults, { flatMonthly: true }).flatMonthly).toBe(true)
  })
})

describe('M3: occurrence math labels', () => {
  it('reads "5 Fridays × $25" for weekly, "13 days × $25" for daily', () => {
    const weekdayName = (d: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]!
    const money = (n: number) => `$${n}`
    expect(occurrenceMathLabel(WEEKLY_25, 25, 2026, 10, weekdayName, money)).toBe('5 Fridays × $25')
    expect(
      occurrenceMathLabel({ calcFrequency: 'daily', billingFrequency: 'monthly', calcWeekdays: [1, 3, 5] }, 25, 2026, 10, weekdayName, money),
    ).toBe('13 days × $25')
    expect(occurrenceMathLabel({ calcFrequency: 'monthly', billingFrequency: 'monthly' }, 100, 2026, 10, weekdayName, money)).toBeNull()
  })
})
