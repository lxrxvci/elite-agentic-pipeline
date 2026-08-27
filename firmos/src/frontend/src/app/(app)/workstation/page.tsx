import type { Metadata } from 'next'

import { asc } from 'drizzle-orm'

import { WorkstationQueue } from '@/components/workstation/queue'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getUnifiedQueue } from '@/server/queue'
import { getCurrentUserId } from '@/server/session'

export const metadata: Metadata = { title: 'FirmOS - Workstation' }

// The queue is per-user and per-day - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * The Workstation - FirmOS's flagship screen (docs/DESIGN_MANDATE.md).
 * One unified queue of everything due across every client; the work engine
 * (src/server/queue.ts) owns bucketing, this page owns presentation.
 */
export default async function WorkstationPage() {
  const userId = await getCurrentUserId()
  const [queue, staff] = await Promise.all([
    getUnifiedQueue(userId),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .orderBy(asc(users.firstName)),
  ])

  const assignees = staff.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`,
    initials: `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase(),
  }))

  return <WorkstationQueue queue={queue} assignees={assignees} />
}
