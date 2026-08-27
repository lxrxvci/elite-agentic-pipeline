'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/shared/lib/auth-client'

type Step = 'credentials' | 'totp'

/**
 * Email/password → optional TOTP second step (HANDOFF §11).
 * Locked accounts surface the server's 423 message verbatim (it carries the
 * minutes remaining); every other credential failure gets the generic
 * "invalid email or password" so the form can't enumerate accounts.
 *
 * The `next` redirect target is read from the URL client-side (kept out of
 * the server page so /login stays static); only same-origin absolute paths
 * are honored.
 */
export function LoginForm() {
  const router = useRouter()
  const rawNext = useSearchParams().get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
  const [step, setStep] = React.useState<Step>('credentials')
  const [useBackupCode, setUseBackupCode] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  function finish() {
    router.push(next)
    router.refresh()
  }

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const { data, error: signInError } = await authClient.signIn.email({ email, password })
      if (signInError) {
        setError(
          signInError.status === 423
            ? (signInError.message ?? 'Account locked. Try again later.')
            : 'Invalid email or password.',
        )
        return
      }
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        setStep('totp')
        return
      }
      finish()
    } finally {
      setPending(false)
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const verify = useBackupCode
        ? authClient.twoFactor.verifyBackupCode({ code })
        : authClient.twoFactor.verifyTotp({ code })
      const { error: verifyError } = await verify
      if (verifyError) {
        setError(
          useBackupCode ? 'Invalid backup code.' : 'Invalid code - check your authenticator and try again.',
        )
        return
      }
      finish()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground">
          F
        </div>
        <h1 className="font-display text-xl font-semibold tracking-tight">FirmOS</h1>
        <p className="text-sm text-muted-foreground">Practice management for your bookkeeping firm</p>
      </div>

      <Card>
        {step === 'credentials' ? (
          <>
            <CardHeader>
              <CardTitle className="text-base">Sign in</CardTitle>
              <CardDescription>Use your firm email and password.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitCredentials} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  Sign in
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                Two-factor authentication
              </CardTitle>
              <CardDescription>
                {useBackupCode
                  ? 'Enter one of your backup codes.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitCode} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="code">{useBackupCode ? 'Backup code' : 'Authentication code'}</Label>
                  <Input
                    id="code"
                    inputMode={useBackupCode ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={pending}
                    placeholder={useBackupCode ? 'xxxxxxxxxx' : '123456'}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  Verify
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setUseBackupCode((v) => !v)
                      setCode('')
                      setError(null)
                    }}
                  >
                    {useBackupCode ? 'Use authenticator code' : 'Use a backup code'}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:underline"
                    onClick={() => {
                      setStep('credentials')
                      setCode('')
                      setError(null)
                    }}
                  >
                    Back
                  </button>
                </div>
              </form>
            </CardContent>
          </>
        )}
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Trouble signing in? Contact your firm administrator.
      </p>
    </div>
  )
}
