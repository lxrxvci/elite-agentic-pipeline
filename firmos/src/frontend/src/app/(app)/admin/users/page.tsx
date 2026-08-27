import type { Metadata } from 'next'

import { UsersTable } from '@/components/admin/users-table'
import { listManagerOptions, listStaffForAdmin } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Users' }

/**
 * /admin/users - staff roles, pay, delegated permissions, and managers
 * (HANDOFF §11, §21). The layout gates the section; requireRole here is the
 * page-level belt.
 */
export default async function AdminUsersPage() {
  const viewer = await requireRole('admin', 'owner')
  const [rows, managers] = await Promise.all([listStaffForAdmin(), listManagerOptions()])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="tnum">{rows.length}</span> staff members · edits are audit-logged and apply on save.
      </p>
      <UsersTable rows={rows} managers={managers} viewerId={viewer.id} />
    </div>
  )
}
