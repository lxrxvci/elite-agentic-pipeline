'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Copy, Eye, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  archiveCredentialAction,
  copyCredentialSecretAction,
  createCredentialAction,
  credentialDetailAction,
  purgeCredentialAction,
  updateCredentialAction,
} from '@/server/actions/vault'
import type { VaultCredentialItem } from '@/server/vault'
import { WorkStatusBadge } from '@/shared/ui/work'

/**
 * Client Credentials tab (Phase 3B). Copy-on-use by design (Jason 01:20:41):
 * passwords are NEVER rendered - the Copy button hands the decrypted secret
 * straight to the clipboard (audited copied_secret, rate-limited server-side)
 * and the toast says so. Usernames are visible in the list; opening Details
 * is the audited viewed_username event and shows the access trail.
 * Add/edit/archive: owner/admin. Purge: owner only, archived rows only.
 */

export interface VaultAccountOption {
  id: number
  name: string
}

export interface ClientCredentialsPanelProps {
  clientId: number
  items: VaultCredentialItem[]
  missingCount: number
  /** owner/admin: add, edit, archive. */
  canManage: boolean
  /** owner only: hard purge of archived rows. */
  canPurge: boolean
  accounts: VaultAccountOption[]
}

const ACCESS_LABELS: Record<string, string> = {
  created: 'Added',
  updated: 'Updated',
  viewed_username: 'Details viewed',
  copied_secret: 'Password copied',
  archived: 'Archived',
}

function accessLabel(action: string): string {
  return ACCESS_LABELS[action] ?? action
}

function shortInstant(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

interface EditState {
  id: number | null // null = create
  label: string
  institution: string
  loginUrl: string
  username: string
  accountId: number | null
  secret: string
}

export function ClientCredentialsPanel({ clientId, items, missingCount, canManage, canPurge, accounts }: ClientCredentialsPanelProps) {
  const router = useRouter()
  const [edit, setEdit] = React.useState<EditState | null>(null)
  const [detailId, setDetailId] = React.useState<number | null>(null)
  const [detail, setDetail] = React.useState<{
    item: VaultCredentialItem
    recentAccess: { action: string; userName: string | null; at: string }[]
  } | null>(null)
  const [archiving, setArchiving] = React.useState<VaultCredentialItem | null>(null)
  const [purging, setPurging] = React.useState<VaultCredentialItem | null>(null)
  const [pending, setPending] = React.useState(false)
  const [copyingId, setCopyingId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const live = items.filter((i) => i.archivedAt == null)
  const archived = items.filter((i) => i.archivedAt != null)

  async function copySecret(item: VaultCredentialItem) {
    setCopyingId(item.id)
    try {
      const result = await copyCredentialSecretAction(item.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      try {
        await navigator.clipboard.writeText(result.data.secret)
        toast.success('Copied — logged for audit')
      } catch {
        toast.error('Clipboard is blocked by the browser - allow clipboard access and try again.')
      }
      router.refresh()
    } finally {
      setCopyingId(null)
    }
  }

  async function openDetail(item: VaultCredentialItem) {
    setDetailId(item.id)
    setDetail(null)
    const result = await credentialDetailAction(item.id)
    if (result.ok) setDetail(result.data)
    else {
      toast.error(result.error)
      setDetailId(null)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    setError(null)
    setPending(true)
    try {
      const payload = {
        label: edit.label,
        institution: edit.institution || null,
        loginUrl: edit.loginUrl || null,
        username: edit.username || null,
        accountId: edit.accountId,
        ...(edit.secret.trim() !== '' ? { secret: edit.secret } : {}),
      }
      const result =
        edit.id == null
          ? await createCredentialAction(clientId, payload)
          : await updateCredentialAction(edit.id, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(edit.id == null ? 'Credential added' : 'Credential updated')
      setEdit(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function confirmArchive() {
    if (!archiving) return
    setPending(true)
    try {
      const result = await archiveCredentialAction(archiving.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Archived ${archiving.label}`)
      setArchiving(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function confirmPurge() {
    if (!purging) return
    setPending(true)
    try {
      const result = await purgeCredentialAction(purging.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Permanently deleted ${purging.label}`)
      setPurging(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="client-credentials-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Client logins live in the encrypted vault. Passwords are never shown on screen - copying
          one is logged with your name.{' '}
          {missingCount > 0 && (
            <span className="font-medium text-foreground">
              {missingCount} expected login{missingCount === 1 ? '' : 's'} still missing.
            </span>
          )}
        </p>
        {canManage && (
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setEdit({ id: null, label: '', institution: '', loginUrl: '', username: '', accountId: null, secret: '' })
            }
            data-testid="add-credential"
          >
            <Plus aria-hidden />
            Add credential
          </Button>
        )}
      </div>

      {live.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No logins in the vault yet. The client can add their own from the portal - or add one here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.map((item) => (
            <li
              key={item.id}
              data-testid={`credential-row-${item.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                  <WorkStatusBadge
                    status={item.status === 'filled' ? 'on_track' : 'waiting_client'}
                    label={item.status === 'filled' ? 'Saved' : 'Waiting for client'}
                  />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[
                    item.institution,
                    item.accountName ? `Account: ${item.accountName}` : null,
                    item.username ? `User: ${item.username}` : 'No username saved',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {item.lastAccess && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {accessLabel(item.lastAccess.action)}
                    {item.lastAccess.userName ? ` by ${item.lastAccess.userName}` : ''} ·{' '}
                    {shortInstant(item.lastAccess.at)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={item.status !== 'filled' || copyingId === item.id}
                  title={item.status === 'filled' ? 'Copy password (logged)' : 'Waiting for the client to add this login'}
                  onClick={() => void copySecret(item)}
                  data-testid={`copy-credential-${item.id}`}
                >
                  {copyingId === item.id ? <Loader2 className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
                  Copy password
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Details for ${item.label}`}
                  onClick={() => void openDetail(item)}
                  data-testid={`detail-credential-${item.id}`}
                >
                  <Eye aria-hidden />
                </Button>
                {canManage && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${item.label}`}
                      onClick={() =>
                        setEdit({
                          id: item.id,
                          label: item.label,
                          institution: item.institution ?? '',
                          loginUrl: item.loginUrl ?? '',
                          username: item.username ?? '',
                          accountId: item.accountId,
                          secret: '',
                        })
                      }
                      data-testid={`edit-credential-${item.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Archive ${item.label}`}
                      onClick={() => setArchiving(item)}
                      data-testid={`archive-credential-${item.id}`}
                    >
                      <Archive aria-hidden />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canPurge && archived.length > 0 && (
        <section aria-label="Archived credentials" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Archived ({archived.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {archived.map((item) => (
              <li
                key={item.id}
                data-testid={`archived-credential-${item.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-2.5 opacity-70"
              >
                <p className="text-sm text-muted-foreground">
                  {item.label}
                  {item.institution ? ` · ${item.institution}` : ''}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Permanently delete ${item.label}`}
                  onClick={() => setPurging(item)}
                  data-testid={`purge-credential-${item.id}`}
                >
                  <Trash2 aria-hidden />
                  Purge
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Details dialog: opening it is the audited viewed_username event. */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.item.label ?? 'Credential details'}</DialogTitle>
            <DialogDescription>
              Everything except the password - that only ever leaves the vault through Copy.
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="flex flex-col gap-4" data-testid="credential-detail">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Institution</dt>
                  <dd className="text-foreground">{detail.item.institution ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Username</dt>
                  <dd className="text-foreground">{detail.item.username ?? '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Sign-in page</dt>
                  <dd className="break-all text-foreground">{detail.item.loginUrl ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Added by</dt>
                  <dd className="text-foreground">
                    {detail.item.createdByName ?? 'Unknown'} (
                    {detail.item.createdVia === 'portal' ? 'client portal' : detail.item.createdVia === 'system' ? 'conversion' : 'staff'})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Password</dt>
                  <dd className="text-foreground">•••••••• (never shown)</dd>
                </div>
              </dl>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Access log
                </h4>
                {detail.recentAccess.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No accesses recorded yet.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1" data-testid="credential-access-log">
                    {detail.recentAccess.map((e, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        {accessLabel(e.action)}
                        {e.userName ? ` — ${e.userName}` : ''} · {shortInstant(e.at)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / edit dialog (owner/admin). Password is write-only. */}
      <Dialog open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.id == null ? 'Add credential' : `Edit ${edit?.label ?? ''}`}</DialogTitle>
            <DialogDescription>
              The client sees this label in their portal. The password is encrypted on save and never
              shown again.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form onSubmit={saveEdit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-cred-label">Label</Label>
                <Input
                  id="staff-cred-label"
                  placeholder="Chase checking"
                  value={edit.label}
                  disabled={pending}
                  onChange={(e) => setEdit((s) => (s ? { ...s, label: e.target.value } : s))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-cred-institution">Institution</Label>
                  <Input
                    id="staff-cred-institution"
                    placeholder="Chase"
                    value={edit.institution}
                    disabled={pending}
                    onChange={(e) => setEdit((s) => (s ? { ...s, institution: e.target.value } : s))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-cred-account">Linked account (optional)</Label>
                  <Select
                    value={edit.accountId != null ? String(edit.accountId) : 'none'}
                    onValueChange={(v) => setEdit((s) => (s ? { ...s, accountId: v === 'none' ? null : Number(v) } : s))}
                    disabled={pending}
                  >
                    <SelectTrigger id="staff-cred-account">
                      <SelectValue placeholder="No linked account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No linked account</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-cred-url">Sign-in URL (optional)</Label>
                <Input
                  id="staff-cred-url"
                  type="url"
                  placeholder="https://"
                  value={edit.loginUrl}
                  disabled={pending}
                  onChange={(e) => setEdit((s) => (s ? { ...s, loginUrl: e.target.value } : s))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-cred-username">Username</Label>
                  <Input
                    id="staff-cred-username"
                    autoComplete="off"
                    value={edit.username}
                    disabled={pending}
                    onChange={(e) => setEdit((s) => (s ? { ...s, username: e.target.value } : s))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="staff-cred-secret">
                    {edit.id == null ? 'Password' : 'New password (blank = keep current)'}
                  </Label>
                  <Input
                    id="staff-cred-secret"
                    type="password"
                    autoComplete="new-password"
                    value={edit.secret}
                    disabled={pending}
                    onChange={(e) => setEdit((s) => (s ? { ...s, secret: e.target.value } : s))}
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending} data-testid="save-credential">
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {edit.id == null ? 'Add to vault' : 'Save changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Archive confirmation (owner/admin). */}
      <Dialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {archiving?.label}?</DialogTitle>
            <DialogDescription>
              The credential leaves the active vault but keeps its audit trail. An owner can purge it
              permanently afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={confirmArchive} data-testid="confirm-archive-credential">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Archive aria-hidden />}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purge confirmation (owner only, archived rows). */}
      <Dialog open={purging !== null} onOpenChange={(open) => !open && setPurging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {purging?.label}?</DialogTitle>
            <DialogDescription>
              This destroys the encrypted secret and cannot be undone. The deletion itself stays in
              the firm audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setPurging(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={confirmPurge} data-testid="confirm-purge-credential">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Purge forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
