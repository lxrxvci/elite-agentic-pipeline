import { describe, expect, it } from 'vitest'
import { calculateQuote, PRICING } from '@firmos/domain'

import { effectiveServiceKeys, type WizardAnswers } from '../registry'

/**
 * M6 (10_10 01:19:20, meeting #5): Jason's platform rule - "I'm only going
 * to charge you $15 a month for this software… that money is going to me,
 * not QuickBooks." Every engagement's estimate carries the FirmOS Client
 * Access line at $15/month, admin-configurable through the same pricing
 * overrides as every other line.
 */

describe('M6: firmos_access_line_prices_at_15 (10_10 01:19:20)', () => {
  it('the pricing entry is the pinned $15/month flat line', () => {
    expect(PRICING.firmos_access).toEqual({
      product_name: 'FirmOS Client Access',
      group: 'other',
      unit_price: 15,
      unit: 'month',
      scaling: 'flat_monthly',
      bucket: 'monthly',
    })
  })

  it('every set engagement derives the line; no engagement type, no line', () => {
    for (const engagementType of ['bookkeeping', 'project', 'consulting'] as const) {
      expect(effectiveServiceKeys({ engagementType, serviceKeys: [] } as unknown as WizardAnswers)).toContain(
        'firmos_access',
      )
    }
    expect(effectiveServiceKeys({ serviceKeys: [] } as unknown as WizardAnswers)).not.toContain('firmos_access')
  })

  it('the quote prices the line at $15/month in the monthly bucket', () => {
    const quote = calculateQuote({
      reportFrequency: 'monthly',
      services: [{ key: 'firmos_access', quantity: 1 }],
    })
    const line = quote.lines.find((l) => l.service_key === 'firmos_access')!
    expect(line.product_name).toBe('FirmOS Client Access')
    expect(line.unit_price).toBe(15)
    expect(line.amount).toBe(15)
    expect(line.bucket).toBe('monthly')
    expect(line.unpriced).toBe(false)
  })

  it('the admin pricing override reprices it like every other line', () => {
    const quote = calculateQuote(
      { reportFrequency: 'monthly', services: [{ key: 'firmos_access', quantity: 1 }] },
      { firmos_access: 25 },
    )
    expect(quote.lines.find((l) => l.service_key === 'firmos_access')!.amount).toBe(25)
  })
})
