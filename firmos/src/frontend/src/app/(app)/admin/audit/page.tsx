import type { Metadata } from 'next'

import { AuditLogTable } from '@/components/admin/audit-log-table'
import { listAuditEvents } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Audit log' }

/**
 * /admin/audit - the append-only audit trail (HANDOFF §11). The table has no
 * update or delete path anywhere in the system; this surface is read-only
 * plus CSV export.
 */
export default async function AdminAuditPage() {
  await requireRole('admin', 'owner')
  const { rows, actions, entityTypes } = await listAuditEvents({ limit: 500 })

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Last <span className="tnum">{rows.length}</span> events · append-only by design.
      </p>
      <AuditLogTable rows={rows} actions={actions} entityTypes={entityTypes} />
    </div>
  )
}
