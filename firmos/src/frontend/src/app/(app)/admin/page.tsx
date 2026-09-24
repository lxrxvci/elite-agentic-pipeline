import type { Metadata } from 'next'

import { AdminHub } from '@/components/admin/admin-hub'
import { getAdminHubOverview } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin' }

// Live operational stats - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * /admin (Phase 3C): the admin control hub - live operational stats with
 * links into each section. Owner/admin only (the layout also gates; this
 * page re-checks before reading anything).
 */
export default async function AdminHubPage() {
  await requireRole('admin', 'owner')
  const now = new Date()
  const overview = await getAdminHubOverview(now)
  return <AdminHub overview={overview} nowIso={now.toISOString()} />
}
