import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getSessionUser } from '@/server/auth/guards'
import { PortalDisabledError, requirePortalEnabled } from '@/server/portal'

import { PortalLoginForm } from './login-form'

export const metadata: Metadata = { title: 'Client portal sign in - FirmOS' }

/**
 * Portal sign-in (HANDOFF §12). Magic-link only: client and CPA accounts
 * sign in with an emailed link; staff use /login. The kill switch answers
 * 404 so a disabled portal is indistinguishable from one never built, and
 * already-signed-in portal users go straight to the portal.
 */
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  try {
    await requirePortalEnabled()
  } catch (error) {
    if (error instanceof PortalDisabledError) notFound()
    throw error
  }

  const user = await getSessionUser()
  if (user && (user.normalizedRole === 'client' || user.normalizedRole === 'cpa')) {
    redirect('/portal')
  }

  const { error } = await searchParams
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <PortalLoginForm verifyError={error ?? null} />
    </div>
  )
}
