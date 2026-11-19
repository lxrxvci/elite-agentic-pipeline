import { describe, expect, it } from 'vitest'

import { buildPatch, effectiveServiceKeys, type WizardAnswers } from '../registry'

describe('existing-client scope', () => {
  it('does not derive retroactive work for an existing client', () => {
    const answers: WizardAnswers = {
      engagementType: 'bookkeeping',
      isExistingClient: true,
      bookkeepingStartDate: '2024-01-01',
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
      serviceKeys: ['retroactive_bookkeeping'],
    }
    expect(effectiveServiceKeys(answers, { year: 2026, month: 11 })).not.toContain('retroactive_bookkeeping')
    expect(buildPatch(answers).formData?.serviceKeys).not.toContain('retroactive_bookkeeping')
    expect(buildPatch(answers).isExistingClient).toBe(true)
    expect(buildPatch(answers).bookkeepingStartDate).toBe('2024-01-01')
  })

  it('keeps retroactive scope for a new client with historical books', () => {
    expect(effectiveServiceKeys({
      engagementType: 'bookkeeping',
      isExistingClient: false,
      bookkeepingStartDate: '2024-01-01',
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '10',
    }, { year: 2026, month: 11 })).toContain('retroactive_bookkeeping')
  })
})
