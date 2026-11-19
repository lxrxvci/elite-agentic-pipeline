import { describe, expect, it } from 'vitest'

import { equityBreakdownOptionsFor, equitySeedPlan } from '../account-types'

const entities = [
  {
    input: { taxStructure: 'Sole proprietorship' },
    names: ['Owner Contribution', "Owner's Draw", "Owner's Equity"],
  },
  {
    input: { taxStructure: 'LLC', llcSubclass: 'llc_sml' },
    names: ['Owner Contribution', "Owner's Draw", "Owner's Equity"],
  },
  {
    input: { taxStructure: 'Partnership' },
    names: ['Partner Contribution', 'Partner Distribution', 'Partner Equity'],
  },
  {
    input: { taxStructure: 'S-corp' },
    names: ['Shareholder Contribution', 'Shareholder Distribution', 'Shareholder Equity'],
  },
  {
    input: { taxStructure: 'C-corp' },
    names: ['Shareholder Contribution', 'Shareholder Distribution', 'Shareholder Equity'],
  },
]

describe('entity-aware equity accounts', () => {
  it.each(entities)('uses the exact account names for $input.taxStructure', ({ input, names }) => {
    const choices = { equitySetup: 'breakdown', equityBreakdown: ['contributions', 'distributions', 'grouped'], ...input }
    expect(equitySeedPlan(choices)?.map((row) => row.name)).toEqual(names)
    expect(equityBreakdownOptionsFor(input).map((row) => row.label)).toEqual(names)
    expect(equitySeedPlan({ equitySetup: 'grouped', ...input })?.map((row) => row.name)).toEqual([names[2]])
  })

  it('keeps legacy net-investment answers and legacy fallbacks', () => {
    expect(equitySeedPlan({ equitySetup: 'breakdown', equityBreakdown: ['net_investment'] })).toEqual([
      { type: 'other_equity', name: 'Net Investment Gain/Loss' },
    ])
    expect(equitySeedPlan({ equitySetup: 'grouped' })?.map((row) => row.name)).toEqual(["Owner's Equity"])
  })
})
