'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/shared/lib/auth-client'

const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/

interface Props {
  user: { email: string; firstName: string; lastName: string; mfaEnabled: boolean }
}

/**
 * Password change (HANDOFF §11: verify current password, enforce policy,
 * revoke every other session on success) and TOTP MFA enrollment with QR +
 * 10 backup codes.
 */
export function SecuritySettings({ user }: Props) {
  const router = useRouter()
  const [mfaEnabled, setMfaEnabled] = React.useState(user.mfaEnabled)

  // ── Change password ──
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [pwError, setPwError] = React.useState<string | null>(null)
  const [pwPending, setPwPending] = React.useState(false)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }
    if (!PASSWORD_POLICY.test(newPassword)) {
      setPwError('Password must be 8-128 characters and include an uppercase letter, a lowercase letter, and a digit.')
      return
    }
    setPwPending(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (error) {
        setPwError(
          error.status === 400 || error.status === 401
            ? 'Current password is incorrect, or the new password does not meet the policy.'
            : (error.message ?? 'Could not change password.'),
        )
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed. Other sessions were signed out.')
      router.refresh()
    } finally {
      setPwPending(false)
    }
  }

  // ── TOTP MFA ──
  const [mfaPassword, setMfaPassword] = React.useState('')
  const [mfaError, setMfaError] = React.useState<string | null>(null)
  const [mfaPending, setMfaPending] = React.useState(false)
  const [enroll, setEnroll] = React.useState<{ totpURI: string; backupCodes: string[]; qr: string } | null>(null)
  const [confirmCode, setConfirmCode] = React.useState('')

  async function startEnroll(e: React.FormEvent) {
    e.preventDefault()
    setMfaError(null)
    setMfaPending(true)
    try {
      const { data, error } = await authClient.twoFactor.enable({ password: mfaPassword })
      if (error || !data) {
        setMfaError(error?.status === 401 || error?.status === 400 ? 'Password is incorrect.' : (error?.message ?? 'Could not start enrollment.'))
        return
      }
      if (data.method !== 'totp') {
        setMfaError('TOTP enrollment is not available for this account.')
        return
      }
      const qr = await QRCode.toDataURL(data.totpURI, { width: 180, margin: 1 })
      setEnroll({ totpURI: data.totpURI, backupCodes: data.backupCodes, qr })
      setMfaPassword('')
    } finally {
      setMfaPending(false)
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault()
    setMfaError(null)
    setMfaPending(true)
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: confirmCode })
      if (error) {
        setMfaError('Invalid code - check your authenticator and try again.')
        return
      }
      toast.success('Two-factor authentication enabled.')
      setEnroll(null)
      setConfirmCode('')
      setMfaEnabled(true)
      router.refresh()
    } finally {
      setMfaPending(false)
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault()
    setMfaError(null)
    setMfaPending(true)
    try {
      const { error } = await authClient.twoFactor.disable({ password: mfaPassword })
      if (error) {
        setMfaError(error?.status === 401 || error?.status === 400 ? 'Password is incorrect.' : (error?.message ?? 'Could not disable two-factor.'))
        return
      }
      toast.success('Two-factor authentication disabled.')
      setMfaPassword('')
      setMfaEnabled(false)
      router.refresh()
    } finally {
      setMfaPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-display text-lg font-semibold tracking-tight">Security settings</h1>
        <p className="text-sm text-muted-foreground">
          {user.firstName} {user.lastName} · {user.email}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>
            Changing your password signs out every other session on this account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={pwPending}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={pwPending}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={pwPending}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              8-128 characters with an uppercase letter, a lowercase letter, and a digit.
            </p>
            {pwError && (
              <p role="alert" className="text-sm text-destructive">
                {pwError}
              </p>
            )}
            <div>
              <Button type="submit" disabled={pwPending}>
                {pwPending && <Loader2 className="animate-spin" aria-hidden />}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {mfaEnabled ? (
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            ) : (
              <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            {mfaEnabled
              ? 'TOTP is enabled. You will need your authenticator app to sign in.'
              : 'Add a TOTP authenticator (1Password, Authy, Google Authenticator) to your account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mfaError && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {mfaError}
            </p>
          )}

          {mfaEnabled ? (
            <form onSubmit={disableMfa} className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-password">Confirm with your password</Label>
                <Input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                  disabled={mfaPending}
                />
              </div>
              <div>
                <Button type="submit" variant="destructive" disabled={mfaPending}>
                  {mfaPending && <Loader2 className="animate-spin" aria-hidden />}
                  Disable two-factor
                </Button>
              </div>
            </form>
          ) : enroll ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                {/* data: URL allowed by CSP img-src */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="TOTP enrollment QR code" width={180} height={180} className="rounded-md border" />
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm font-medium">1. Scan with your authenticator app</p>
                  <p className="text-xs break-all text-muted-foreground">
                    Can&apos;t scan? Add this URI manually: {enroll.totpURI}
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">2. Save your backup codes</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Each code works once if you lose your device. Store them somewhere safe - they are
                  shown only now.
                </p>
                <ul className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-3">
                  {enroll.backupCodes.map((c) => (
                    <li key={c} className="rounded border bg-muted/50 px-2 py-1 text-center">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <form onSubmit={confirmEnroll} className="flex max-w-sm flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-code">3. Enter the 6-digit code to finish</Label>
                  <Input
                    id="confirm-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    disabled={mfaPending}
                    placeholder="123456"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={mfaPending}>
                    {mfaPending && <Loader2 className="animate-spin" aria-hidden />}
                    Enable two-factor
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEnroll(null)} disabled={mfaPending}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <form onSubmit={startEnroll} className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-password">Confirm with your password</Label>
                <Input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                  disabled={mfaPending}
                />
              </div>
              <div>
                <Button type="submit" disabled={mfaPending}>
                  {mfaPending && <Loader2 className="animate-spin" aria-hidden />}
                  Set up two-factor
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
