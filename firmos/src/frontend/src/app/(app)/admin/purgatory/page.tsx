import type { Metadata } from 'next'

import { PurgatoryQueue } from '@/components/admin/purgatory-queue'
import { getAdminApprovalsQueue } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Purgatory' }

/**
 * /admin/purgatory - every pending approval request in one queue (HANDOFF
 * §22, §29). The engine enforces four-eyes and role rules; the UI mirrors
 * them so the disable state is legible before the click.
 */
export default async function AdminPurgatoryPage() {
  const viewer = await requireRole('admin', 'owner')
  const items = await getAdminApprovalsQueue()

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="tnum">{items.length}</span> pending · a request is always reviewed by a
        different user than the requester.
      </p>
      <PurgatoryQueue
        items={items}
        viewer={{ id: viewer.id, role: viewer.normalizedRole as 'admin' | 'owner' }}
      />
    </div>
  )
}
