import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PortalHomeView, type RecentUpload } from '@/components/portal/home-view'
import { getPortalPageState } from '@/components/portal/server'
import { isPortalRequestTitle } from '@/components/portal/status'
import { getDocumentTree } from '@/server/documents'
import { getPortalInvoices } from '@/server/portal-invoices'
import {
  PortalCapabilityError,
  getPortalTaskOverview,
  getWaitingOnYou,
} from '@/server/portal'

export const metadata: Metadata = { title: 'Portal home - FirmOS' }

/**
 * Portal home (HANDOFF §12): the waiting-on-you list plus a compact status
 * summary. CPAs land on their client list instead; a client without an
 * acting selection renders nothing here (the layout shows the chooser).
 */
export default async function PortalHomePage() {
  const state = await getPortalPageState()
  if (state.user.normalizedRole === 'cpa') redirect('/portal/cpa')
  if (!state.access) return null

  const { user, access } = state
  const [waiting, tree, portalInvoices] = await Promise.all([
    getWaitingOnYou(user, access.clientId),
    getDocumentTree(access.clientId),
    getPortalInvoices(user, access.clientId),
  ])

  // Task overview is gated on can_view_tasks (§29); without it the summary
  // simply omits the request count rather than failing the page.
  let openRequestCount: number | null = null
  try {
    const overview = await getPortalTaskOverview(user, access.clientId)
    openRequestCount = overview.cards.filter((c) => isPortalRequestTitle(c.title)).length
  } catch (error) {
    if (!(error instanceof PortalCapabilityError)) throw error
  }

  const recentUploads: RecentUpload[] = Object.values(tree.documentsByGroup)
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 3)
    .map((d) => ({ id: d.id, fileName: d.fileName, createdAt: d.createdAt }))

  return (
    <PortalHomeView
      firstName={user.firstName}
      clientName={access.clientName}
      waiting={waiting}
      openRequestCount={openRequestCount}
      recentUploads={recentUploads}
      invoiceCount={portalInvoices.length}
    />
  )
}
