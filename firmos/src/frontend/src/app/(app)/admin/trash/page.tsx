import type { Metadata } from 'next'

import { TrashBinTable } from '@/components/admin/trash-bin-table'
import { requireRole } from '@/server/auth/guards'
import { listTrashedTasks, TRASH_RETENTION_DAYS } from '@/server/trash'

export const metadata: Metadata = { title: 'FirmOS - Admin - Trash' }

/**
 * /admin/trash - soft-deleted tasks awaiting the scheduled 30-day purge
 * (HANDOFF §9). Restore clears deleted_at; "Delete forever" purges the row
 * immediately behind an inline confirm. Both actions are audit-logged.
 */
export default async function AdminTrashPage() {
  await requireRole('admin', 'owner')
  const items = await listTrashedTasks()

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="tnum">{items.length}</span> trashed {items.length === 1 ? 'task' : 'tasks'}{' '}
        · rows purge automatically <span className="tnum">{TRASH_RETENTION_DAYS}</span> days after
        deletion.
      </p>
      <TrashBinTable items={items} />
    </div>
  )
}
