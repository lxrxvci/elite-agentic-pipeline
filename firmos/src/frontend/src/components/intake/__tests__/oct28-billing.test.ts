import { describe, expect, it } from 'vitest'
import type { Quote } from '@firmos/domain'

import { buildBillingProjection, buildBucketedEstimate } from '../review-estimate'
import type { WizardAnswers } from '../registry'

function annualSpecialtyQuote(): Quote {
  return {
    billingCycle: 1,
    lines: [
      {
        service_key: 'specialty_report_1',
        product_name: 'Specialty Report: Annual report',
        unit_price: 250,
        quantity: 1 / 12,
        amount: 250 / 12,
        bucket: 'monthly',
        unpriced: false,
      },
    ],
    totals: {
      totalMonthly: 250 / 12,
      totalQuarterly: 0,
      annualExcludingFebruaryBilled: 0,
      totalPayrollMonthly: 0,
      totalFebruaryBilledAnnual: 0,
      totalOneTime: 0,
      effectiveMonthly: 250 / 12,
    },
  }
}

function annualAnswers(lineBilling?: WizardAnswers['lineBilling']): WizardAnswers {
  return {
    engagementType: 'bookkeeping',
    reportFrequency: 'monthly',
    routineSchedule: {
      'specialty:Annual report': { bucket: 'annual', order: 0, daysAfterPeriodEnd: 31 },
    },
    billingMonths: { specialty_report_1: 1 },
    lineBilling,
  } as WizardAnswers
}

function januaryAmount(quote: Quote, answers: WizardAnswers): number {
  const estimate = buildBucketedEstimate(quote, answers)
  const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, answers, { year: 2026, month: 10 })
  return projection.find((month) => month.year === 2027 && month.month === 1)!.lines[0]!.amount
}

describe('October 28 annual specialty billing remediation', () => {
  it('oct28_annual_specialty_250_bills_250_in_january', () => {
    expect(januaryAmount(annualSpecialtyQuote(), annualAnswers())).toBe(250)
  })

  it('oct28_annual_override_never_double_divides', () => {
    expect(januaryAmount(annualSpecialtyQuote(), annualAnswers({ specialty_report_1: { calcFrequency: 'annual', billingFrequency: 'annual', calcUnitPrice: 25 } }))).toBe(25)
  })

  it('oct28_monthly_25_billed_annually_is_300', () => {
    expect(januaryAmount(annualSpecialtyQuote(), annualAnswers({ specialty_report_1: { calcFrequency: 'monthly', billingFrequency: 'annual', calcUnitPrice: 25 } }))).toBe(300)
  })

  it('oct28_annual_250_billed_monthly_is_20_83', () => {
    const answers = annualAnswers({ specialty_report_1: { calcFrequency: 'annual', billingFrequency: 'monthly' } })
    const estimate = buildBucketedEstimate(annualSpecialtyQuote(), answers)
    const projection = buildBillingProjection(estimate.groups, estimate.oneTime, estimate.retroItems, answers, { year: 2026, month: 10 })
    expect(projection[0]!.lines[0]!.amount).toBe(20.83)
  })
})
