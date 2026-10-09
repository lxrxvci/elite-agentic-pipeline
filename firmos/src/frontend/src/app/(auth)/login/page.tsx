import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { getSessionUser } from '@/server/auth/guards'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in - FirmOS' }

/**
 * Dynamic: the session is validated server-side and signed-in users go
 * straight to / (the /portal/login pattern). A STALE cookie renders the
 * form - never a middleware redirect loop (10_09 prod incident: cookie
 * presence said signed-in, the guard said signed-out, ERR_TOO_MANY_REDIRECTS).
 */
export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect('/')
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
