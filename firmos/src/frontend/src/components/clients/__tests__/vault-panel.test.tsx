import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { ClientCredentialsPanel } from '../vault-panel'
import type { VaultCredentialItem } from '@/server/vault'

/**
 * Staff Credentials tab (Phase 3B): the masked list (label/institution/
 * username visible, password never rendered), the audited clipboard copy
 * flow with its "logged for audit" toast, and the permission-driven buttons
 * (manage = owner/admin, purge = owner, archived rows only).
 */

const copyCredentialSecretAction = vi.fn()
const credentialDetailAction = vi.fn()
const createCredentialAction = vi.fn()
const updateCredentialAction = vi.fn()
const archiveCredentialAction = vi.fn()
const purgeCredentialAction = vi.fn()

vi.mock('@/server/actions/vault', () => ({
  copyCredentialSecretAction: (...args: unknown[]) => copyCredentialSecretAction(...args),
  credentialDetailAction: (...args: unknown[]) => credentialDetailAction(...args),
  createCredentialAction: (...args: unknown[]) => createCredentialAction(...args),
  updateCredentialAction: (...args: unknown[]) => updateCredentialAction(...args),
  archiveCredentialAction: (...args: unknown[]) => archiveCredentialAction(...args),
  purgeCredentialAction: (...args: unknown[]) => purgeCredentialAction(...args),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// userEvent.setup() installs its own navigator.clipboard stub - spy on THAT
// (after setup) rather than racing it with defineProperty.
const spyOnClipboard = () => vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

function item(over: Partial<VaultCredentialItem> = {}): VaultCredentialItem {
  return {
    id: 1,
    clientId: 10,
    accountId: null,
    accountName: 'Operating Checking',
    label: 'Chase checking',
    institution: 'Chase',
    loginUrl: 'https://www.chase.com',
    username: 'harborline-ops',
    status: 'filled',
    createdById: 99,
    createdByName: 'Mara Ellison',
    createdVia: 'portal',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    lastAccess: null,
    ...over,
  }
}

describe('ClientCredentialsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists masked credentials: label, institution, username - never a password field', () => {
    render(
      <ClientCredentialsPanel clientId={10} items={[item()]} missingCount={0} canManage canPurge accounts={[]} />,
    )
    const row = screen.getByTestId('credential-row-1')
    expect(row).toHaveTextContent('Chase checking')
    expect(row).toHaveTextContent('Chase')
    expect(row).toHaveTextContent('User: harborline-ops')
    expect(row).toHaveTextContent('Saved')
    // No password input and no plaintext anywhere in the panel.
    expect(document.querySelectorAll('input[type=password]')).toHaveLength(0)
    expect(screen.getByTestId('client-credentials-panel')).not.toHaveTextContent('hunter2')
  })

  it('expected slots read "Waiting for client" and refuse copies', () => {
    render(
      <ClientCredentialsPanel
        clientId={10}
        items={[item({ status: 'expected', username: null })]}
        missingCount={1}
        canManage
        canPurge
        accounts={[]}
      />,
    )
    expect(screen.getByText('Waiting for client')).toBeInTheDocument()
    expect(screen.getByText(/1 expected login still missing/)).toBeInTheDocument()
    expect(screen.getByTestId('copy-credential-1')).toBeDisabled()
  })

  it('copy flow: the secret goes straight to the clipboard with the audit toast', async () => {
    copyCredentialSecretAction.mockResolvedValue({ ok: true, data: { secret: 's3cret-value' } })
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(
      <ClientCredentialsPanel clientId={10} items={[item()]} missingCount={0} canManage canPurge accounts={[]} />,
    )

    await user.click(screen.getByTestId('copy-credential-1'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('s3cret-value'))
    expect(toast.success).toHaveBeenCalledWith('Copied — logged for audit')
  })

  it('copy failures surface the server error (e.g. rate limit) as a toast', async () => {
    copyCredentialSecretAction.mockResolvedValue({
      ok: false,
      status: 429,
      error: 'Copy limit reached',
    })
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(
      <ClientCredentialsPanel clientId={10} items={[item()]} missingCount={0} canManage canPurge accounts={[]} />,
    )
    await user.click(screen.getByTestId('copy-credential-1'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Copy limit reached'))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('hides manage affordances from bookkeepers (canManage=false) and purge from non-owners', () => {
    const archived = item({ id: 2, label: 'Old login', archivedAt: '2026-09-10T00:00:00.000Z' })
    render(
      <ClientCredentialsPanel
        clientId={10}
        items={[item(), archived]}
        missingCount={0}
        canManage={false}
        canPurge={false}
        accounts={[]}
      />,
    )
    // Bookkeeper: copy + details stay, add/edit/archive disappear.
    expect(screen.getByTestId('copy-credential-1')).toBeEnabled()
    expect(screen.getByTestId('detail-credential-1')).toBeInTheDocument()
    expect(screen.queryByTestId('add-credential')).not.toBeInTheDocument()
    expect(screen.queryByTestId('edit-credential-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('archive-credential-1')).not.toBeInTheDocument()
    // Non-owner: the archived purge section never renders.
    expect(screen.queryByTestId('purge-credential-2')).not.toBeInTheDocument()
  })

  it('owner purge review: archived section with a confirm dialog', async () => {
    purgeCredentialAction.mockResolvedValue({ ok: true, data: { purged: true } })
    const archived = item({ id: 2, label: 'Old login', archivedAt: '2026-09-10T00:00:00.000Z' })
    const user = userEvent.setup()
    render(
      <ClientCredentialsPanel clientId={10} items={[archived]} missingCount={0} canManage canPurge accounts={[]} />,
    )
    await user.click(screen.getByTestId('purge-credential-2'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Permanently delete Old login?')
    await user.click(screen.getByTestId('confirm-purge-credential'))
    await waitFor(() => expect(purgeCredentialAction).toHaveBeenCalledWith(2))
  })

  it('opening Details audits the view and renders the access log', async () => {
    credentialDetailAction.mockResolvedValue({
      ok: true,
      data: {
        item: item(),
        recentAccess: [
          { action: 'copied_secret', userName: 'Jorge Medina', at: '2026-09-20T10:00:00.000Z' },
          { action: 'created', userName: 'Alison Brewer', at: '2026-09-01T00:00:00.000Z' },
        ],
      },
    })
    const user = userEvent.setup()
    render(
      <ClientCredentialsPanel clientId={10} items={[item()]} missingCount={0} canManage canPurge accounts={[]} />,
    )
    await user.click(screen.getByTestId('detail-credential-1'))
    await waitFor(() => expect(credentialDetailAction).toHaveBeenCalledWith(1))
    const log = await screen.findByTestId('credential-access-log')
    expect(log).toHaveTextContent('Password copied — Jorge Medina')
    expect(log).toHaveTextContent('Added — Alison Brewer')
  })

  it('owner/admin add dialog encrypts on save through the create action', async () => {
    createCredentialAction.mockResolvedValue({ ok: true, data: item({ id: 3 }) })
    const user = userEvent.setup()
    render(
      <ClientCredentialsPanel
        clientId={10}
        items={[]}
        missingCount={0}
        canManage
        canPurge={false}
        accounts={[{ id: 5, name: 'Operating Checking' }]}
      />,
    )
    await user.click(screen.getByTestId('add-credential'))
    await user.type(screen.getByLabelText('Label'), 'Chase checking')
    await user.type(screen.getByLabelText('Username'), 'ops-user')
    await user.type(screen.getByLabelText('Password'), 'staff-entered-secret')
    await user.click(screen.getByTestId('save-credential'))
    await waitFor(() => expect(createCredentialAction).toHaveBeenCalledTimes(1))
    expect(createCredentialAction.mock.calls[0][1]).toMatchObject({
      label: 'Chase checking',
      username: 'ops-user',
      secret: 'staff-entered-secret',
    })
  })
})
