'use client'

import * as React from 'react'
import Link from 'next/link'
import { Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/shared/lib/auth-client'

/**
 * Portal magic-link request card (HANDOFF §12). One input, one outcome: the
 * server answers identically for client, CPA, staff, and unknown addresses
 * (no enumeration), so the UI always lands on the same "check your email"
 * state. In dev (FIRMOS_DEV_LINKS=1, non-production) the sign-in link is
 * shown inline in a subtle banner so local work and e2e runs do not need a
 * mailbox.
 */
export function PortalLoginForm({ verifyError }: { verifyError: string | null }) {
  const [email, setEmail] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(verifyError)
  const [pending, setPending] = React.useState(false)
  const [devLink, setDevLink] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const { error: sendError } = await authClient.signIn.magicLink({
        email,
        callbackURL: '/portal',
      })
      if (sendError) {
        setError('Could not send the sign-in link - try again in a moment.')
        return
      }
      setSent(true)
      // Dev convenience: the link inline. 404 in production - stays hidden.
      try {
        const res = await fetch(`/portal/api/dev-magic-link?email=${encodeURIComponent(email)}`)
        if (res.ok) {
          const body = (await res.json()) as { url?: string }
          if (body.url) setDevLink(body.url)
        }
      } catch {
        // Dev banner is best-effort; the email copy is the real path.
      }
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
        <h1 className="font-display text-xl font-semibold tracking-tight">FirmOS Client Portal</h1>
        <p className="text-sm text-muted-foreground">Documents, statements, and reports from your bookkeeper</p>
      </div>

      <Card>
        {sent ? (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MailCheck className="h-4 w-4 text-primary" aria-hidden />
                Check your email
              </CardTitle>
              <CardDescription>
                If <span className="font-medium text-foreground">{email}</span> is registered with
                your firm, a sign-in link is on its way. It expires in 15 minutes and works once.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {devLink && (
                <div
                  data-testid="dev-magic-link"
                  className="rounded-md border border-dashed border-border bg-muted/60 px-3 py-2"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Dev only - sign-in link
                  </p>
                  <a
                    href={devLink}
                    className="mt-1 block break-all text-[13px] text-primary hover:underline"
                  >
                    {devLink}
                  </a>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSent(false)
                  setDevLink(null)
                }}
              >
                Use a different email
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-base">Sign in with a magic link</CardTitle>
              <CardDescription>
                Enter the email your firm has on file and we will send you a sign-in link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="portal-email">Email</Label>
                  <Input
                    id="portal-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                  Email me a sign-in link
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Firm staff sign in <Link href="/login" className="text-primary hover:underline">here</Link>.
      </p>
    </div>
  )
}
