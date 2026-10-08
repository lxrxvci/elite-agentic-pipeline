import { describe, expect, it } from 'vitest'

import { SPECIALTY_REPORT_DEFAULT_TIERS, specialtyReportPrice } from '@firmos/domain'

import { findQuestion, type WizardAnswers } from '../registry'

/**
 * L3 (10_06 00:25:07-00:31:41): specialty reports price flat OR by estimated
 * hours per difficulty tier (bookkeeper/manager/owner x the admin tier
 * rates, defaults $75/$100/$150). Tier-priced lines carry the
 * "pricing may vary based on the employee selected" caveat.
 */

describe('L3: hourly_report_prices_hours_times_tier_sum (10_06 00:27:38)', () => {
  it('tier hours x the default tier rates', () => {
    const price = specialtyReportPrice({
      name: 'Oregon Special Report',
      frequency: 'annual',
      tierHours: { bookkeeper: 2, manager: 1, owner: 0.5 },
    })
    // 2x75 + 1x100 + 0.5x150 = 325
    expect(price).toBe(325)
  })

  it('admin-configured tiers change the math', () => {
    const price = specialtyReportPrice(
      { name: 'X', frequency: 'annual', tierHours: { bookkeeper: 1, manager: 1, owner: 1 } },
      { bookkeeper: 80, manager: 110, owner: 175 },
    )
    expect(price).toBe(365)
    expect(SPECIALTY_REPORT_DEFAULT_TIERS).toEqual({ bookkeeper: 75, manager: 100, owner: 150 })
  })

  it('flat_and_hourly_modes_mutually_exclusive: the flat price always wins', () => {
    const price = specialtyReportPrice({
      name: 'X',
      frequency: 'annual',
      flatPrice: 400,
      tierHours: { bookkeeper: 10 },
    })
    expect(price).toBe(400)
  })

  it('no flat and no tier hours falls back to legacy estimatedHours x rate, then unpriced', () => {
    expect(specialtyReportPrice({ name: 'X', frequency: 'annual', estimatedHours: 2, hourlyRate: 120 })).toBe(240)
    expect(specialtyReportPrice({ name: 'X', frequency: 'annual' })).toBeNull()
  })
})

describe('L3: the intake question (mode pick + tier fields + bulleted review)', () => {
  const reportsQ = findQuestion('reporting', 'reports')!
  const fields = reportsQ.repeatable?.itemFields ?? []
  const byKey = (k: string) => fields.find((f) => f.key === k)

  it('offers the pricing-mode pick with conditional tier fields', () => {
    const mode = byKey('pricingMode')
    expect(mode).toBeTruthy()
    expect(mode?.options?.map((o) => o.value)).toEqual(['hours', 'flat'])
    // Tier fields only show in hours mode; the flat price only in flat mode.
    expect(byKey('flatPrice')?.visibleIf?.({ pricingMode: 'flat' })).toBe(true)
    expect(byKey('flatPrice')?.visibleIf?.({ pricingMode: 'hours' })).toBe(false)
    expect(byKey('tierBookkeeperHours')?.visibleIf?.({ pricingMode: 'hours' })).toBe(true)
    expect(byKey('tierBookkeeperHours')?.visibleIf?.({ pricingMode: 'flat' })).toBe(false)
    expect(byKey('tierManagerHours')).toBeTruthy()
    expect(byKey('tierOwnerHours')).toBeTruthy()
    // The single estimated-hours field is gone (hours live per tier now).
    expect(byKey('estimatedHours')).toBeUndefined()
  })

  it('specialty_reports_render_as_bulleted_list (F7): the review summary is bullet lines, never commas', () => {
    const text = reportsQ.summarize({
      reportDefinitions: [
        { name: 'Oregon Special Report', frequency: 'annual' },
        { name: 'Water Quality Report', frequency: 'quarterly' },
      ],
    } as unknown as WizardAnswers)
    expect(text).toBe('• Oregon Special Report\n• Water Quality Report')
    expect(text).not.toContain(',')
  })
})
