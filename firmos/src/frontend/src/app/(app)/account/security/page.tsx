import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getWorkingHoursStatus } from '@/server/approvals'
import { getSessionUser } from '@/server/auth/guards'
import { firmTimezone } from '@/server/notifications'

import { SecuritySettings } from './security-settings'
import { WorkingHoursSettings } from './working-hours-settings'

export const metadata: Metadata = { title: 'Security settings - FirmOS' }

export default async function SecurityPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/account/security')
  const workingHours = await getWorkingHoursStatus(user.id)
  return (
    <SecuritySettings
      user={{
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mfaEnabled: user.mfaEnabled,
      }}
    >
      <WorkingHoursSettings status={workingHours} timeZone={firmTimezone()} />
    </SecuritySettings>
  )
}
