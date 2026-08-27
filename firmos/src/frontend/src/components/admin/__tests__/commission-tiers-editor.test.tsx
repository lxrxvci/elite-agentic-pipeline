import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setCommissionTiersAction } from '@/server/actions/pricing'

import { CommissionTiersEditor, validateTierDrafts } from '../commission-tiers-editor'

vi.mock('@/server/actions/pricing', () => ({
  setCommissionTiersAction: vi.fn(),
  setPricingOverrideAction: vi.fn(),
}))

const mockSet = vi.mocked(setCommissionTiersAction)

const DEFAULT_TIERS = [
  { minOnTimePercent: 100, rate: 50 },
  { minOnTimePercent: 90, rate: 45 },
  { minOnTimePercent: 80, rate: 40 },
  { minOnTimePercent: 0, rate: 35 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockSet.mockImplementation(async (tiers) => ({ ok: true as const, data: { tiers } }))
})

describe('validateTierDrafts', () => {
  it('accepts a descending table within range', () => {
    expect(
      validateTierDrafts([
        { threshold: '99', rate: '45' },
        { threshold: '0', rate: '35' },
      ]),
    ).toBeNull()
  })

  it('rejects an empty table', () => {
    expect(validateTierDrafts([])).toMatch(/at least one/i)
  })

  it('rejects ascending or duplicate thresholds', () => {
    expect(
      validateTierDrafts([
        { threshold: '80', rate: '40' },
        { threshold: '90', rate: '45' },
      ]),
    ).toMatch(/descending/i)
    expect(
      validateTierDrafts([
        { threshold: '90', rate: '45' },
        { threshold: '90', rate: '40' },
      ]),
    ).toMatch(/descending/i)
  })

  it('rejects out-of-range and non-numeric values', () => {
    expect(validateTierDrafts([{ threshold: '101', rate: '50' }])).toMatch(/threshold/i)
    expect(validateTierDrafts([{ threshold: '90', rate: '-1' }])).toMatch(/rate/i)
    expect(validateTierDrafts([{ threshold: '', rate: '50' }])).toMatch(/threshold/i)
  })
})

describe('CommissionTiersEditor', () => {
  it('renders the configured tiers and keeps save disabled until dirty', () => {
    render(<CommissionTiersEditor tiers={DEFAULT_TIERS} floorRate={35} />)
    expect(screen.getByLabelText('Tier 1 on-time percent threshold')).toHaveValue('100')
    expect(screen.getByLabelText('Tier 4 commission rate')).toHaveValue('35')
    expect(screen.getByRole('button', { name: /save tiers/i })).toBeDisabled()
  })

  it('saves an edited table parsed to numbers', async () => {
    render(<CommissionTiersEditor tiers={DEFAULT_TIERS} floorRate={35} />)
    const threshold = screen.getByLabelText('Tier 2 on-time percent threshold')
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '99')
    const save = screen.getByRole('button', { name: /save tiers/i })
    expect(save).toBeEnabled()
    await userEvent.click(save)
    expect(mockSet).toHaveBeenCalledWith([
      { minOnTimePercent: 100, rate: 50 },
      { minOnTimePercent: 99, rate: 45 },
      { minOnTimePercent: 80, rate: 40 },
      { minOnTimePercent: 0, rate: 35 },
    ])
  })

  it('adds and removes tier rows', async () => {
    render(<CommissionTiersEditor tiers={DEFAULT_TIERS} floorRate={35} />)
    await userEvent.click(screen.getByRole('button', { name: /add tier/i }))
    expect(screen.getByLabelText('Tier 5 on-time percent threshold')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove tier 5' }))
    expect(screen.queryByLabelText('Tier 5 on-time percent threshold')).not.toBeInTheDocument()
    // Back to the pristine baseline: save disabled again.
    expect(screen.getByRole('button', { name: /save tiers/i })).toBeDisabled()
  })

  it('blocks save with an inline alert when ordering is invalid', async () => {
    render(<CommissionTiersEditor tiers={DEFAULT_TIERS} floorRate={35} />)
    const threshold = screen.getByLabelText('Tier 1 on-time percent threshold')
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '50') // now below tier 2's 90
    const save = screen.getByRole('button', { name: /save tiers/i })
    expect(save).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/strictly descending/i)
  })
})
