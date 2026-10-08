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
