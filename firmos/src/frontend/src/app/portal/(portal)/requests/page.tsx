import type { Metadata } from 'next'

import { PortalRequestsView, type RequestCardItem } from '@/components/portal/requests-view'
import { requireClientRolePage } from '@/components/portal/server'
import { isPortalRequestTitle } from '@/components/portal/status'
import { localToday } from '@/server/dates'
import { PortalCapabilityError, getPortalTaskOverview } from '@/server/portal'
import { formatLocalDate } from '@firmos/domain'

export const metadata: Metadata = { title: 'Portal requests - FirmOS' }

/**
 * Portal requests (HANDOFF §12). New requests mint ad-hoc tasks for the
 * bookkeeper through createPortalRequest; the list reads the acting
 * client's request tasks back through the (capability-gated) task overview.
 */
export default async function PortalRequestsPage() {
  const { state, access } = await requireClientRolePage()
  if (!access) return null

  const today = localToday()
  let cards: RequestCardItem[] = []
  const canViewTasks = access.capabilities.canViewTasks
  if (canViewTasks) {
    try {
      const overview = await getPortalTaskOverview(state.user, access.clientId, today)
      cards = overview.cards
        .filter((c) => isPortalRequestTitle(c.title))
        .map((c) => ({
          key: `${c.kind}-${c.id}`,
          title: c.title,
          status: c.status,
          dueDate: c.dueDate,
          attributedYear: c.attributedYear,
          attributedMonth: c.attributedMonth,
        }))
    } catch (error) {
      if (!(error instanceof PortalCapabilityError)) throw error
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ask your bookkeeping team for documents or help with {access.clientName}.
        </p>
      </div>

      <PortalRequestsView
        clientId={access.clientId}
        today={formatLocalDate(today)}
        cards={cards}
        canViewTasks={canViewTasks}
      />
    </div>
  )
}
