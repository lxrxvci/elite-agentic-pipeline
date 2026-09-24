'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { archivePortalCredential, savePortalCredential } from '@/server/actions/portal-vault'
import type { VaultCredentialItem } from '@/server/vault'

/**
 * Portal credential vault (Phase 3B): the client enters their own bank and
 * software logins. Plain-language rules on the page:
 *  - passwords are never shown back after saving (reads return masked);
 *  - staff get copy-on-use access and every use is logged;
 *  - conversion-seeded "waiting for your login" slots say exactly which
 *    account is expected (intake's "grant us login access" flags).
 * The panel never receives and never renders a secret.
 */

export interface PortalCredentialsPanelProps {
  clientId: number
  /** The signed-in portal user - an entry is editable only by its creator. */
  currentUserId: number
  expected: VaultCredentialItem[]
  saved: VaultCredentialItem[]
}

interface FormState {
  id: number | null
  /** 'fill' = completing an expected slot (label fixed by the firm). */
  mode: 'create' | 'edit' | 'fill'
  label: string
  institution: string
  loginUrl: string
  username: string
  secret: string
}

const EMPTY_FORM: FormState = {
  id: null,
  mode: 'create',
  label: '',
  institution: '',
  loginUrl: '',
  username: '',
  secret: '',
}

export function PortalCredentialsPanel({ clientId, currentUserId, expected, saved }: PortalCredentialsPanelProps) {
  const router = useRouter()
  const [form, setForm] = React.useState<FormState | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<VaultCredentialItem | null>(null)

  const openCreate = () => setForm({ ...EMPTY_FORM })
  const openFill = (item: VaultCredentialItem) =>
    setForm({
      id: item.id,
      mode: 'fill',
      label: item.label,
      institution: item.institution ?? '',
      loginUrl: item.loginUrl ?? '',
      username: item.username ?? '',
      secret: '',
    })
  const openEdit = (item: VaultCredentialItem) =>
    setForm({
      id: item.id,
      mode: 'edit',
      label: item.label,
      institution: item.institution ?? '',
      loginUrl: item.loginUrl ?? '',
      username: item.username ?? '',
      secret: '',
    })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    setPending(true)
    try {
      const result = await savePortalCredential(clientId, {
        id: form.id,
        label: form.label,
        institution: form.institution || null,
        loginUrl: form.loginUrl || null,
        username: form.username || null,
        secret: form.secret,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(form.mode === 'create' ? 'Login saved securely' : 'Login updated')
      setForm(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!removing) return
    setPending(true)
    try {
      const result = await archivePortalCredential(clientId, removing.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Removed ${removing.label}`)
      setRemoving(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="portal-credentials-panel">
      {/* Plain-language promise (Jason 01:20:41). */}
      <section
        aria-label="How the vault works"
        className="rounded-xl border border-border bg-card px-5 py-4 shadow-card"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-sm">
            <p className="font-medium text-foreground">Your logins stay yours.</p>
            <p className="mt-1 text-muted-foreground">
              Add a password once and we never show it back to you - not here, not in an email. Your
              bookkeeping team copies it only when they need to sign in, and every copy is logged for
              you to see.
            </p>
          </div>
        </div>
      </section>

      {expected.length > 0 && (
        <section aria-label="Logins we still need" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Waiting for your login</h2>
          <ul className="flex flex-col gap-2">
            {expected.map((item) => (
              <li
                key={item.id}
                data-testid={`credential-slot-${item.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-firm-brand/50 bg-accent/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.institution ?? 'Online access'}
                    {item.accountName ? ` · ${item.accountName}` : ''}
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => openFill(item)} data-testid={`fill-slot-${item.id}`}>
                  <KeyRound aria-hidden />
                  Add login
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Saved logins" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Saved logins</h2>
          <Button type="button" size="sm" variant="outline" onClick={openCreate} data-testid="add-credential">
            <Plus aria-hidden />
            Add a login
          </Button>
        </div>
        {saved.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing saved yet{expected.length > 0 ? ' - start with the ones above.' : '.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {saved.map((item) => {
              const own = item.createdById === currentUserId
              return (
                <li
                  key={item.id}
                  data-testid={`credential-row-${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[item.institution, item.username, 'Password: ••••••••']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.loginUrl && (
                      <a
                        href={item.loginUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-firm-brand-strong underline-offset-2 hover:underline"
                      >
                        Sign-in page
                      </a>
                    )}
                    {own && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(item)}
                          aria-label={`Edit ${item.label}`}
                          data-testid={`edit-credential-${item.id}`}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoving(item)}
                          aria-label={`Remove ${item.label}`}
                          data-testid={`remove-credential-${item.id}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Add / edit / fill dialog. The password field is write-only by design:
          edit mode never pre-fills it, and leaving it blank keeps the old one. */}
      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.mode === 'create'
                ? 'Add a login'
                : form?.mode === 'fill'
                  ? `Add the ${form.label} login`
                  : `Edit ${form?.label ?? 'login'}`}
            </DialogTitle>
            <DialogDescription>
              Saved straight into the encrypted vault. We never show the password back after this.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              {form.mode === 'create' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-label">What is this login for?</Label>
                  <Input
                    id="cred-label"
                    placeholder="Chase checking"
                    value={form.label}
                    disabled={pending}
                    onChange={(e) => setForm((f) => (f ? { ...f, label: e.target.value } : f))}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-institution">Bank or service (optional)</Label>
                  <Input
                    id="cred-institution"
                    placeholder="Chase"
                    value={form.institution}
                    disabled={pending}
                    onChange={(e) => setForm((f) => (f ? { ...f, institution: e.target.value } : f))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cred-login-url">Sign-in page (optional)</Label>
                  <Input
                    id="cred-login-url"
                    type="url"
                    placeholder="https://www.chase.com"
                    value={form.loginUrl}
                    disabled={pending}
                    onChange={(e) => setForm((f) => (f ? { ...f, loginUrl: e.target.value } : f))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cred-username">Username</Label>
                <Input
                  id="cred-username"
                  autoComplete="off"
                  value={form.username}
                  disabled={pending}
                  onChange={(e) => setForm((f) => (f ? { ...f, username: e.target.value } : f))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cred-secret">
                  {form.mode === 'edit' ? 'New password (leave blank to keep the current one)' : 'Password'}
                </Label>
                <Input
                  id="cred-secret"
                  type="password"
                  autoComplete="new-password"
                  value={form.secret}
                  disabled={pending}
                  onChange={(e) => setForm((f) => (f ? { ...f, secret: e.target.value } : f))}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending} data-testid="save-credential">
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Lock aria-hidden />}
                  Save securely
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove confirmation (soft archive server-side; the audit row stays). */}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.label}?</DialogTitle>
            <DialogDescription>
              The login is removed from the vault and your team loses access to it. This is logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={remove}
              data-testid="confirm-remove-credential"
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Remove login
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
