import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminSettings } from '@/server/admin-reads'
import { updateAdminSettingsAction } from '@/server/actions/admin'

import { SettingsForm } from '../settings-form'

vi.mock('@/server/actions/admin', () => ({
  updateAdminSettingsAction: vi.fn(),
}))

const mockUpdate = vi.mocked(updateAdminSettingsAction)

const SETTINGS: AdminSettings = {
  orgName: 'Blue Ledger Books',
  purgeEnabled: false,
  clientPortalEnabled: false,
  maxClockInHours: 10,
  commissionPayout: 'next_month_first',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({ ok: true, data: { saved: true } })
})

describe('SettingsForm', () => {
  it('saves with the feature flags toggled on', async () => {
    render(<SettingsForm settings={SETTINGS} />)

    const save = screen.getByRole('button', { name: /save settings/i })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /enable client purge/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /enable client portal/i }))

    expect(save).toBeEnabled()
    await userEvent.click(save)

    expect(mockUpdate).toHaveBeenCalledWith({
      orgName: 'Blue Ledger Books',
      purgeEnabled: true,
      clientPortalEnabled: true,
      maxClockInHours: 10,
      commissionPayout: 'next_month_first',
    })
  })

  it('keeps save disabled until something changes', async () => {
    render(<SettingsForm settings={SETTINGS} />)
    const save = screen.getByRole('button', { name: /save settings/i })

    const org = screen.getByLabelText(/organization name/i)
    await userEvent.clear(org)
    await userEvent.type(org, 'Blue Ledger Books')
    // Same value as the baseline - nothing to save.
    expect(save).toBeDisabled()
  })
})
