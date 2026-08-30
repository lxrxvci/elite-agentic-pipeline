import { redirect } from 'next/navigation'

import { getSessionUser } from '@/server/auth/guards'

export const dynamic = 'force-dynamic'

/**
 * Role-based landing (FIRMOS-VISUAL-ELITE-PLAN Wave 2): owner/admin open on
 * the firm-wide Progression Board - the "where is every client" screen -
 * while bookkeepers and managers start at their Workstation. Portal roles
 * go straight to their own surface, signed-out users to /login.
 */
export default async function Home() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.normalizedRole === 'client' || user.normalizedRole === 'cpa') redirect('/portal')
  redirect(user.normalizedRole === 'owner' || user.normalizedRole === 'admin' ? '/progress' : '/workstation')
}
