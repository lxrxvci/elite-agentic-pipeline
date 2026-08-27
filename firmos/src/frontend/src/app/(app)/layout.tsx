import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/guards'
import { getTotalUnreadCount } from '@/server/chat'
import { AppShell } from '@/components/shell/app-shell'

/**
 * Staff shell guard (HANDOFF §30 conv. 10): portal roles are rejected at the
 * boundary, not filtered downstream. Signed-out users go to /login; portal
 * users go to their own surface.
 *
 * Also feeds the sidebar: the Messages item carries the caller's total
 * unread chat count (§16), read server-side on every navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.normalizedRole === 'client' || user.normalizedRole === 'cpa') redirect('/portal')
  const chatUnread = await getTotalUnreadCount(user.id).catch(() => 0)
  return (
    <AppShell role={user.normalizedRole} chatUnread={chatUnread}>
      {children}
    </AppShell>
  )
}
