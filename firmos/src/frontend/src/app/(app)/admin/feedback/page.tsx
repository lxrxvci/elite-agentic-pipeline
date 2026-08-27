import type { Metadata } from 'next'

import { FeedbackList } from '@/components/admin/feedback-list'
import { listFeedbackForAdmin } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Feedback' }

/**
 * /admin/feedback - triage for the §16 feedback widget. Rows move pending ->
 * reviewed -> addressed through audit-logged actions.
 */
export default async function AdminFeedbackPage() {
  await requireRole('admin', 'owner')
  const rows = await listFeedbackForAdmin()

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="tnum">{rows.length}</span> reports · pending to reviewed to addressed.
      </p>
      <FeedbackList rows={rows} />
    </div>
  )
}
