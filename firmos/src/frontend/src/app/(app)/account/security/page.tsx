import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSessionUser } from '@/server/auth/guards'

import { SecuritySettings } from './security-settings'

export const metadata: Metadata = { title: 'Security settings - FirmOS' }

export default async function SecurityPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/account/security')
  return (
    <SecuritySettings
      user={{
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mfaEnabled: user.mfaEnabled,
      }}
    />
  )
}
