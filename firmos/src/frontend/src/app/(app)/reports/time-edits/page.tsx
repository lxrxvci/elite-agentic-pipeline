import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { TimeEditReview } from '@/components/reports/time-edit-review'
import { requireStaff } from '@/server/auth/guards'

import { listTimeEditQueue } from '../_lib/data'

export const metadata: Metadata = { title: 'FirmOS - Time Edit Requests' }
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['admin', 'owner'])

export default async function TimeEditsPage() {
  const user = await requireStaff()
  if (!ALLOWED.has(user.normalizedRole)) redirect('/reports')

  const rows = await listTimeEditQueue()

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Time edit requests
        </h1>
        <p className="text-xs text-muted-foreground">
          Staff cannot edit their own recorded time - approve to apply the corrected span, or
          reject to leave it untouched.
        </p>
      </div>
      <TimeEditReview rows={rows} />
    </div>
  )
}
