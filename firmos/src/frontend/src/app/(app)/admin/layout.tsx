import { ShieldCheck } from 'lucide-react'

import { AdminSubNav } from '@/components/admin/admin-sub-nav'
import { EmptyState } from '@/components/empty-state'
import { getSessionUser } from '@/server/auth/guards'

// Admin data is per-actor and mutable - never static.
export const dynamic = 'force-dynamic'

/**
 * /admin section guard (HANDOFF §11): owner and admin only. Managers and
 * bookkeepers see nothing here - no sub-nav, no data, just the quiet access
 * note. Server actions re-check the role on every mutation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  const allowed =
    user != null && (user.normalizedRole === 'admin' || user.normalizedRole === 'owner')

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldCheck aria-hidden />}
        title="Administration is limited"
        description="Only admins and owners can open the admin console. Nothing here applies to your role."
      />
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Admin
        </h1>
        <AdminSubNav />
      </div>
      {children}
    </div>
  )
}
