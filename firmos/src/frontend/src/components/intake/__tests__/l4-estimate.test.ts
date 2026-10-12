import { describe, expect, it } from 'vitest'
import type { Quote } from '@firmos/domain'

import { buildBucketedEstimate } from '../review-estimate'
import type { WizardAnswers } from '../registry'

/**
 * L4 (10_06): the estimate speaks honest cadences - one-time fees never
 * bundle retro, annual is never amortized into /mo, and retro cleanup
 * splits into per-period priced lines (year default, quarter optional).
 */

const RETRO_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
    { service_key: 'qbo_setup', product_name: 'QBO Setup', unit_price: 150, quantity: 1, amount: 150, bucket: 'one_time', unpriced: false },
    { service_key: '1099_collection', product_name: '1099 Collection', unit_price: 50, quantity: 1, amount: 50, bucket: 'annual', unpriced: false },
    { service_key: 'retroactive_bookkeeping', product_name: 'Retroactive Bookkeeping', unit_price: 350, quantity: 9, amount: 3150, bucket: 'one_time', unpriced: false },
  ],
  totals: {
    totalMonthly: 100,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 50,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    // The engine bundles retro into totalOneTime (the G4 trap).
    totalOneTime: 150 + 3150,
    effectiveMonthly: 100,
  },
  retroactive: { months: 9, startMonth: { year: 2025, month: 10 }, perMonthRate: 350, baseTotal: 3150, discountPercent: null, total: 3150 },
}

const ANSWERS = { engagementType: 'bookkeeping' } as unknown as WizardAnswers

describe('L4/G4: one_time_and_retro_total_separately (10_06 01:14:26)', () => {
  it('the one-time header total excludes the retro block entirely', () => {
    const estimate = buildBucketedEstimate(RETRO_QUOTE, ANSWERS)
    expect(estimate.oneTimeTotal).toBe(150) // QBO setup only - never the 3,150 retro
    expect(estimate.retroTotal).toBe(3150)
    expect(estimate.retroTotal + estimate.oneTimeTotal).toBe(3300)
  })
})

describe('L4/G5: retro_splits_priced_lines_per_year (10_06 01:15:27)', () => {
  it('9 months from Oct 2025 split into per-year priced lines', () => {
    const estimate = buildBucketedEstimate(RETRO_QUOTE, ANSWERS)
    const years = estimate.retroItems.filter((i) => i.key.startsWith('retroactive_bookkeeping'))
    expect(years).toHaveLength(2)
    expect(years[0]).toMatchObject({ name: '2025 cleanup', amount: 1050, standard: 1050 })
    expect(years[0].math).toBe('3 months × $350/mo')
    expect(years[1]).toMatchObject({ name: '2026 cleanup', amount: 2100, standard: 2100 })
    expect(years[1].math).toBe('6 months × $350/mo')
    // The block still totals the whole cleanup.
    expect(years.reduce((a, i) => a + (i.amount ?? 0), 0)).toBe(3150)
  })

  it('the quarter toggle splits by quarter instead', () => {
    const estimate = buildBucketedEstimate(RETRO_QUOTE, ANSWERS, 'quarter')
    const periods = estimate.retroItems.filter((i) => i.key.startsWith('retroactive_bookkeeping'))
    expect(periods.map((p) => p.name)).toEqual(['2025 Q4 cleanup', '2026 Q1 cleanup', '2026 Q2 cleanup'])
    expect(periods.map((p) => p.amount)).toEqual([1050, 1050, 1050])
  })

  it('a flat override stays one bundled line (the J4/V4 rule)', () => {
    const quote: Quote = {
      ...RETRO_QUOTE,
      lines: RETRO_QUOTE.lines.map((l) =>
        l.service_key === 'retroactive_bookkeeping' ? { ...l, price_override: 2500 } : l,
      ),
      retroactive: { ...RETRO_QUOTE.retroactive!, total: 2500 },
    }
    const estimate = buildBucketedEstimate(quote, ANSWERS)
    const items = estimate.retroItems.filter((i) => i.key === 'retroactive_bookkeeping')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'Retroactive bookkeeping', amount: 2500, overridden: true })
  })
})

describe('L4/G2: annual_lines_never_amortize_into_monthly (10_06 01:07:03)', () => {
  it('the annual bucket totals per year and no line math amortizes to /mo', () => {
    const estimate = buildBucketedEstimate(RETRO_QUOTE, ANSWERS)
    const annual = estimate.groups.find((g) => g.bucket === 'annual')
    expect(annual).toBeTruthy()
    expect(annual!.perYear).toBe(50)
    for (const line of annual!.lines) {
      expect(line.math ?? '').not.toContain('÷ 12')
      expect(line.math ?? '').not.toContain('/mo')
    }
    const quarterly = estimate.groups.find((g) => g.bucket === 'quarterly')
    for (const line of quarterly?.lines ?? []) {
      expect(line.math ?? '').not.toContain('÷ 3')
    }
  })
})

describe('L4/G8: weekly lines show occurrence math (10_06 01:04:50)', () => {
  it('a weekly custom rule shows the per-month weekday-count math, not a flat x4', () => {
    const quote: Quote = {
      billingCycle: 1,
      lines: [
        {
          service_key: 'custom_rule_1',
          product_name: 'Friday deposit run',
          unit_price: 100,
          quantity: 4,
          amount: 400,
          bucket: 'monthly',
          unpriced: false,
        },
      ],
      totals: {
        totalMonthly: 400,
        totalQuarterly: 0,
        annualExcludingFebruaryBilled: 0,
        totalPayrollMonthly: 0,
        totalFebruaryBilledAnnual: 0,
        totalOneTime: 0,
        effectiveMonthly: 400,
      },
    }
    const estimate = buildBucketedEstimate(quote, {
      engagementType: 'bookkeeping',
      customRecurringRules: [{ title: 'Friday deposit run', scheduleType: 'weekly', daysOfWeek: '5', isBillable: true, unitPrice: 100, subtasks: [] }],
    } as unknown as WizardAnswers)
    const line = estimate.groups.flatMap((g) => g.lines).find((l) => l.key === 'custom_rule_1')
    expect(line?.math).toContain('$100/week')
    expect(line?.math).toContain('billed by the month')
    expect(line?.math).toMatch(/\w{3}: \d+ × \$100 = \$\d+/)
    expect(line?.math).not.toContain('× 4 weeks')
  })
})

/**
 * M4 (10_10, 00:56:00-01:12:43): the 12-month forward billing projection -
 * every month computed from the line's billing model, annual fees landing
 * in their month, own-invoice lines grouped separately.
 */
describe('M4: the 12-month billing projection (10_10 00:56:00)', () => {
  const PROJECTION_QUOTE: Quote = {
    billingCycle: 1,
    lines: [
      { service_key: 'bank_feed_management', product_name: 'Bank Feed Management', unit_price: 100, quantity: 1, amount: 100, bucket: 'monthly', unpriced: false },
      { service_key: 'record_bills', product_name: 'Record Bills', unit_price: 25, quantity: 1, amount: 25, bucket: 'monthly', unpriced: false },
      { service_key: '1099_collection', product_name: '1099 Collection', unit_price: 50, quantity: 1, amount: 50, bucket: 'annual', unpriced: false },
    ],
    totals: {
      totalMonthly: 125,
      totalQuarterly: 0,
      annualExcludingFebruaryBilled: 0,
      totalPayrollMonthly: 0,
      totalFebruaryBilledAnnual: 50,
      totalOneTime: 0,
      effectiveMonthly: 125,
    },
  }

  const SCHEDULE: NonNullable<WizardAnswers['routineSchedule']> = {
    'record-bills': { bucket: 'weekly', order: 0, weekdays: [5], everyNWeeks: 1 },
  }

  it('twelve_month_preview_counts_occurrences: Fridays per actual month; monthly lines flat; 1099 lands in February', async () => {
    const { buildBillingProjection } = await import('../review-estimate')
    const estimate = buildBucketedEstimate(PROJECTION_QUOTE, { ...ANSWERS, routineSchedule: SCHEDULE })
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, ANSWERS, { year: 2026, month: 10 })

    expect(projection).toHaveLength(12)
    const byLabel = new Map(projection.map((m) => [`${m.year}-${m.month}`, m]))
    // October 2026: 5 Fridays × $25 + $100 monthly.
    expect(byLabel.get('2026-10')!.normalTotal).toBe(225)
    // November: 4 Fridays.
    expect(byLabel.get('2026-11')!.normalTotal).toBe(200)
    // The 1099 ($50, February default) lands ONLY in February.
    expect(byLabel.get('2026-10')!.lines.some((l) => l.key === '1099_collection')).toBe(false)
    expect(byLabel.get('2027-2')!.lines.some((l) => l.key === '1099_collection' && l.amount === 50)).toBe(true)
    expect(byLabel.get('2027-2')!.normalTotal).toBe(250)
  })

  it('annual_fee_lands_in_january_on_preview: an assigned January line shows there with its note', async () => {
    const { buildBillingProjection } = await import('../review-estimate')
    const answers = {
      ...ANSWERS,
      routineSchedule: SCHEDULE,
      billingMonths: { '1099_collection': 1 },
    } as unknown as WizardAnswers
    const estimate = buildBucketedEstimate(PROJECTION_QUOTE, answers)
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, answers, { year: 2026, month: 10 })
    const jan = projection.find((m) => m.year === 2027 && m.month === 1)!
    const fee = jan.lines.find((l) => l.key === '1099_collection')!
    expect(fee.amount).toBe(50)
    expect(fee.note).toBe('billed each January')
    // February keeps the other lines but no 1099 (moved to January).
    const feb = projection.find((m) => m.year === 2027 && m.month === 2)!
    expect(feb.lines.some((l) => l.key === '1099_collection')).toBe(false)
  })

  it('own_invoice_lines_group_separately (01:12:43)', async () => {
    const { buildBillingProjection } = await import('../review-estimate')
    const answers = {
      ...ANSWERS,
      routineSchedule: SCHEDULE,
      lineBilling: { record_bills: { ownInvoice: true } },
    } as unknown as WizardAnswers
    const estimate = buildBucketedEstimate(PROJECTION_QUOTE, answers)
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, answers, { year: 2026, month: 10 })
    const oct = projection[0]!
    // record_bills ($125 Oct) sits in its own invoice total, not the normal one.
    expect(oct.ownInvoiceTotal).toBe(125)
    expect(oct.normalTotal).toBe(100)
    expect(oct.lines.find((l) => l.key === 'record_bills')!.ownInvoice).toBe(true)
  })

  it('a weekly-BILLED line totals as that month\u2019s weekly invoices', async () => {
    const { buildBillingProjection } = await import('../review-estimate')
    const answers = {
      ...ANSWERS,
      routineSchedule: SCHEDULE,
      lineBilling: { record_bills: { billingFrequency: 'weekly' } },
    } as unknown as WizardAnswers
    const estimate = buildBucketedEstimate(PROJECTION_QUOTE, answers)
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, answers, { year: 2026, month: 10 })
    const oct = projection[0]!
    // October 2026 has 4 Sundays (4, 11, 18, 25) -> 4 weekly invoices x $25.
    const line = oct.lines.find((l) => l.key === 'record_bills')!
    expect(line.amount).toBe(100)
    expect(line.note).toBe('4 weekly invoices')
  })

  it('one-time and retro fees land on the first invoice only', async () => {
    const { buildBillingProjection } = await import('../review-estimate')
    const withOneTime: Quote = {
      ...PROJECTION_QUOTE,
      lines: [
        ...PROJECTION_QUOTE.lines,
        { service_key: 'qbo_setup', product_name: 'QBO Setup', unit_price: 150, quantity: 1, amount: 150, bucket: 'one_time', unpriced: false },
      ],
      totals: { ...PROJECTION_QUOTE.totals, totalOneTime: 150 },
    }
    const estimate = buildBucketedEstimate(withOneTime, { ...ANSWERS, routineSchedule: SCHEDULE })
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, ANSWERS, { year: 2026, month: 10 })
    expect(projection[0]!.lines.some((l) => l.key === 'qbo_setup' && l.amount === 150 && l.note === 'one-time')).toBe(true)
    expect(projection[1]!.lines.some((l) => l.key === 'qbo_setup')).toBe(false)
  })
})
