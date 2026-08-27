import type { Metadata } from 'next'

import { NotificationsList } from '@/components/notifications/notifications-list'
import { requireStaff } from '@/server/auth/guards'
import { listNotifications } from '@/server/notifications'

export const metadata: Metadata = { title: 'FirmOS - Notifications' }

// Per-user rows change with every bell event - never static.
export const dynamic = 'force-dynamic'

/**
 * Notification center (HANDOFF §16). Staff-only via the (app) layout guard;
 * requireStaff here is the page-level belt. Data comes from the notifications
 * engine; the client list owns filtering and row actions.
 */
export default async function NotificationsPage() {
  const user = await requireStaff()
  const rows = await listNotifications(user.id, { filter: 'all', limit: 200 })

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Notifications
        </h1>
        <p className="text-xs text-muted-foreground">
          <span className="tnum">{rows.length}</span> recent rows · alerts, approvals, and client replies.
        </p>
      </div>
      <NotificationsList initialRows={rows} />
    </div>
  )
}
