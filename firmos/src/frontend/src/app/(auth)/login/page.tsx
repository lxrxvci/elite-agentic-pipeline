import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in - FirmOS' }

/**
 * Static by design: the only dynamic input (the `next` redirect target) is
 * read from the URL inside LoginForm via useSearchParams, which the Suspense
 * boundary keeps out of the prerender.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
