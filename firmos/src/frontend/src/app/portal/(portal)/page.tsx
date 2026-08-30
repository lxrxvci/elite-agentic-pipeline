import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PortalHomeView, type RecentUpload } from '@/components/portal/home-view'
import { getPortalPageState } from '@/components/portal/server'
import { isPortalRequestTitle } from '@/components/portal/status'
import { localToday } from '@/server/dates'
import { getDocumentTree } from '@/server/documents'
import { getPortalInvoices } from '@/server/portal-invoices'
import { getPortalYearGrid } from '@/server/portal-progress'
import { YEAR_GRID_STREAMS, type YearGridStream } from '@/server/year-grid'
import {
  PortalCapabilityError,
  getPortalTaskOverview,
  getWaitingOnYou,
} from '@/server/portal'

export const metadata: Metadata = { title: 'Portal home - FirmOS' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Portal home (HANDOFF §12, Wave 4 progress parity): the acting client's
 * own year grid (same engine truth and cell language the staff grid
 * renders, read-only) above the waiting-on-you list and a compact status
 * summary. CPAs land on their client list instead; a client without an
 * acting selection renders nothing here (the layout shows the chooser).
 */
export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const state = await getPortalPageState()
  if (state.user.normalizedRole === 'cpa') redirect('/portal/cpa')
  if (!state.access) return null

  const { year: rawYear } = await searchParams
  const { user, access } = state
  const today = localToday()
  const parsedYear = Number(rawYear)
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : today.year

  const [waiting, tree, portalInvoices, progressGrid] = await Promise.all([
    getWaitingOnYou(user, access.clientId),
    getDocumentTree(access.clientId),
    getPortalInvoices(user, access.clientId),
    getPortalYearGrid(user, access.clientId, year, today),
  ])

  // Task overview is gated on can_view_tasks (§29); without it the summary
  // simply omits the request count rather than failing the page. The same
  // capability gates the grid's tasks row: without it the client sees only
  // bank feeds, reconciliations, and reports.
  let openRequestCount: number | null = null
  try {
    const overview = await getPortalTaskOverview(user, access.clientId)
    openRequestCount = overview.cards.filter((c) => isPortalRequestTitle(c.title)).length
  } catch (error) {
    if (!(error instanceof PortalCapabilityError)) throw error
  }

  const progressStreams: YearGridStream[] = access.capabilities.canViewTasks
    ? YEAR_GRID_STREAMS
    : YEAR_GRID_STREAMS.filter((s) => s !== 'tasks')

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
      progressGrid={progressGrid}
      progressStreams={progressStreams}
    />
  )
}
