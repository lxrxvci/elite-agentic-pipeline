import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalCredentialsPanel } from '../vault-panel'
import type { VaultCredentialItem } from '@/server/vault'

/**
 * Portal vault (Phase 3B): expected slots render with the plain-language
 * promise, filling a slot posts the secret to the save action, saved entries
 * are always masked, and edit/remove exists only on the creator's own rows.
 */

const savePortalCredential = vi.fn()
const archivePortalCredential = vi.fn()

vi.mock('@/server/actions/portal-vault', () => ({
  savePortalCredential: (...args: unknown[]) => savePortalCredential(...args),
  archivePortalCredential: (...args: unknown[]) => archivePortalCredential(...args),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function item(over: Partial<VaultCredentialItem> = {}): VaultCredentialItem {
  return {
    id: 1,
    clientId: 10,
    accountId: null,
    accountName: null,
    label: 'Chase checking',
    institution: 'Chase',
    loginUrl: null,
    username: null,
    status: 'expected',
    createdById: 99,
    createdByName: 'Mara Ellison',
    createdVia: 'system',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    lastAccess: null,
    ...over,
  }
}

describe('PortalCredentialsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders expected slots and the never-show-back promise', () => {
    render(
      <PortalCredentialsPanel clientId={10} currentUserId={7} expected={[item()]} saved={[]} />,
    )
    expect(screen.getByTestId('credential-slot-1')).toHaveTextContent('Chase checking')
    expect(screen.getByText(/never show it back/i)).toBeInTheDocument()
    expect(screen.getByText('Waiting for your login')).toBeInTheDocument()
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument()
  })

  it('filling an expected slot posts username + password + url against the slot id', async () => {
    savePortalCredential.mockResolvedValue({ ok: true, data: item({ status: 'filled' }) })
    const user = userEvent.setup()
    render(
      <PortalCredentialsPanel clientId={10} currentUserId={7} expected={[item()]} saved={[]} />,
    )

    await user.click(screen.getByTestId('fill-slot-1'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Username'), 'alison-brewer')
    await user.type(screen.getByLabelText('Password'), 'super-secret-pw')
    await user.type(screen.getByLabelText(/Sign-in page/), 'https://www.chase.com')
    await user.click(screen.getByTestId('save-credential'))

    await waitFor(() => expect(savePortalCredential).toHaveBeenCalledTimes(1))
    expect(savePortalCredential).toHaveBeenCalledWith(10, {
      id: 1,
      label: 'Chase checking',
      institution: 'Chase',
      loginUrl: 'https://www.chase.com',
      username: 'alison-brewer',
      secret: 'super-secret-pw',
    })
  })

  it('adding a new login requires the label field and posts a create (no id)', async () => {
    savePortalCredential.mockResolvedValue({ ok: true, data: item({ id: 2, status: 'filled' }) })
    const user = userEvent.setup()
    render(<PortalCredentialsPanel clientId={10} currentUserId={7} expected={[]} saved={[]} />)

    await user.click(screen.getByTestId('add-credential'))
    await user.type(screen.getByLabelText(/What is this login for/), 'Gusto payroll')
    await user.type(screen.getByLabelText('Username'), 'alison@harborline.com')
    await user.type(screen.getByLabelText('Password'), 'gusto-pw')
    await user.click(screen.getByTestId('save-credential'))

    await waitFor(() => expect(savePortalCredential).toHaveBeenCalledTimes(1))
    expect(savePortalCredential.mock.calls[0][1]).toMatchObject({
      id: null,
      label: 'Gusto payroll',
      username: 'alison@harborline.com',
      secret: 'gusto-pw',
    })
  })

  it('saved entries are masked; edit/remove render only on the creator’s own rows', () => {
    const mine = item({ id: 2, status: 'filled', createdById: 7, label: 'Gusto payroll', username: 'alison' })
    const theirs = item({ id: 3, status: 'filled', createdById: 99, label: 'Bank of the West', institution: 'BofW' })
    render(
      <PortalCredentialsPanel clientId={10} currentUserId={7} expected={[]} saved={[mine, theirs]} />,
    )
    // Masked: the fixed bullet mask renders, never a real password.
    expect(screen.getAllByText(/Password: ••••••••/)).toHaveLength(2)
    expect(screen.getByTestId('edit-credential-2')).toBeInTheDocument()
    expect(screen.getByTestId('remove-credential-2')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-credential-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('remove-credential-3')).not.toBeInTheDocument()
  })

  it('removing an own entry confirms, then archives through the action', async () => {
    archivePortalCredential.mockResolvedValue({ ok: true, data: { archived: true } })
    const user = userEvent.setup()
    const mine = item({ id: 2, status: 'filled', createdById: 7, label: 'Gusto payroll' })
    render(<PortalCredentialsPanel clientId={10} currentUserId={7} expected={[]} saved={[mine]} />)

    await user.click(screen.getByTestId('remove-credential-2'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Remove Gusto payroll?')
    await user.click(screen.getByTestId('confirm-remove-credential'))
    await waitFor(() => expect(archivePortalCredential).toHaveBeenCalledWith(10, 2))
  })

  it('surfaces a server validation error inside the dialog', async () => {
    savePortalCredential.mockResolvedValue({ ok: false, status: 400, error: 'Enter the password for this login' })
    const user = userEvent.setup()
    render(<PortalCredentialsPanel clientId={10} currentUserId={7} expected={[]} saved={[]} />)

    await user.click(screen.getByTestId('add-credential'))
    await user.type(screen.getByLabelText(/What is this login for/), 'X')
    await user.click(screen.getByTestId('save-credential'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the password for this login')
  })
})
