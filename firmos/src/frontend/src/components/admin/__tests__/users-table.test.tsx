import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { AdminStaffRow } from '@/server/admin-reads'
import { updateStaffUserAction } from '@/server/actions/admin'

import { UsersTable } from '../users-table'

vi.mock('@/server/actions/admin', () => ({
  updateStaffUserAction: vi.fn(),
}))

const mockUpdate = vi.mocked(updateStaffUserAction)

function staff(partial: Partial<AdminStaffRow>): AdminStaffRow {
  return {
    id: 1,
    name: 'Dana Whitfield',
    email: 'dana@blueledgerbooks.com',
    role: 'manager',
    isActive: true,
    baseHourlyPay: null,
    commissionRateOverride: null,
    idleTimeoutMinutes: 15,
    managerId: null,
    managerName: null,
    canAccessStatements: false,
    canEditTaskTemplates: false,
    canEditSops: false,
    canEditTaxTemplates: false,
    ...partial,
  }
}

const MANAGERS = [
  { id: 1, name: 'Mara Ellison' },
  { id: 2, name: 'Theo Park' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({ ok: true, data: { updated: true } })
})

describe('UsersTable', () => {
  it('normalizes stored role casing in the role select', () => {
    // Production data carries both casings (§11) - the select always shows
    // and submits the lowercase canonical form.
    render(
      <TooltipProvider>
        <UsersTable rows={[staff({ role: 'Admin' })]} managers={MANAGERS} viewerId={99} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('combobox', { name: /role for dana/i })).toHaveTextContent('admin')
  })

  it('sends the normalized lowercase role and edited fields on save', async () => {
    render(
      <TooltipProvider>
        <UsersTable rows={[staff({ role: 'Admin' })]} managers={MANAGERS} viewerId={99} />
      </TooltipProvider>,
    )

    await userEvent.type(screen.getByRole('textbox', { name: /hourly pay/i }), '42.5')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdate).toHaveBeenCalledWith(1, {
      role: 'admin',
      isActive: true,
      baseHourlyPay: '42.5',
      commissionRateOverride: null,
      idleTimeoutMinutes: 15,
      managerId: null,
      canAccessStatements: false,
      canEditTaskTemplates: false,
      canEditSops: false,
      canEditTaxTemplates: false,
    })
  })

  it('hides save until a row is dirty', () => {
    render(
      <TooltipProvider>
        <UsersTable rows={[staff({})]} managers={MANAGERS} viewerId={99} />
      </TooltipProvider>,
    )
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.className).toContain('invisible')
  })

  it('disables role and active edits on the viewer’s own row', () => {
    render(
      <TooltipProvider>
        <UsersTable rows={[staff({ id: 7 })]} managers={MANAGERS} viewerId={7} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('combobox', { name: /role for dana/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /active: dana/i })).toBeDisabled()
  })
})
