import { describe, expect, it } from 'vitest'

import { deriveRoutineTasks, effectiveServiceKeys, type WizardAnswers } from '../registry'

/**
 * L1 (G11, 10_06 01:08:32): "If I were to unselect [monthly bookkeeping]
 * right now, would it get rid of a lot of tasks?" Neither dared try live -
 * this pins the cascade so nobody has to be brave: unselecting bookkeeping
 * drops every derived routine and service; reselecting restores them.
 */

const BOOKKEEPING: WizardAnswers = {
  legalName: 'Cascade Co',
  engagementType: 'bookkeeping',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  recordBills: true,
  recordDeposits: true,
  customRecurringRules: [{ title: 'Walk my dog', scheduleType: 'monthly', isBillable: true, unitPrice: 150, subtasks: [] }],
} as unknown as WizardAnswers

describe('L1/G11: unselect_engagement_cascades_cleanly (10_06 01:08:32)', () => {
  it('bookkeeping off drops every routine and the bookkeeping-only services; back on restores them', () => {
    const routinesOn = deriveRoutineTasks(BOOKKEEPING)
    expect(routinesOn.length).toBeGreaterThan(4)
    const servicesOn = effectiveServiceKeys(BOOKKEEPING)
    expect(servicesOn).toContain('monthly_reporting_10')
    expect(servicesOn).toContain('record_bills')
    expect(servicesOn).toContain('record_deposits')

    // Unselect monthly bookkeeping (one-time project track): every routine
    // and the reporting cadence goes. Bill/deposit ENTRY services persist by
    // design - one-time scopes can carry them (catch-up projects).
    const off = { ...BOOKKEEPING, engagementType: 'project' } as WizardAnswers
    expect(deriveRoutineTasks(off)).toEqual([])
    const servicesOff = effectiveServiceKeys(off)
    expect(servicesOff).not.toContain('monthly_reporting_10')
    expect(servicesOff).toContain('record_bills')
    expect(servicesOff).toContain('record_deposits')

    // Reselecting restores everything - nothing is lost by the toggle.
    const routinesBack = deriveRoutineTasks(BOOKKEEPING)
    expect(routinesBack.map((t) => t.key)).toEqual(routinesOn.map((t) => t.key))
    const servicesBack = effectiveServiceKeys(BOOKKEEPING)
    expect(servicesBack).toEqual(servicesOn)
  })

  it('consulting also drops the recurring world (one-off track)', () => {
    const off = { ...BOOKKEEPING, engagementType: 'consulting' } as WizardAnswers
    expect(deriveRoutineTasks(off)).toEqual([])
    expect(effectiveServiceKeys(off)).not.toContain('monthly_reporting_10')
  })
})
