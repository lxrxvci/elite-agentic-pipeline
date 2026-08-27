import type { Metadata } from 'next'
import { inArray } from 'drizzle-orm'

import { ChooseBusiness } from '@/components/portal/choose-business'
import { getPortalPageState } from '@/components/portal/server'
import { PortalShell } from '@/components/portal/shell'
import { db } from '@/db'
import { clients } from '@/db/schema'

export const metadata: Metadata = { title: 'Client portal - FirmOS' }

/**
 * Authenticated portal chrome (HANDOFF §12). All guarding lives in
 * getPortalPageState: kill switch -> 404, signed out -> /portal/login,
 * staff -> 404. A client-role user without a valid acting-client selection
 * gets the choose-your-business screen in place of page content; CPAs go
 * straight to their shell (no cookie selection - they pass client ids in
 * the URL).
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const state = await getPortalPageState()
  const { user, ctx } = state

  const needsSelection = user.normalizedRole === 'client' && state.selection !== 'ok'

  // §20 - the Properties nav item renders only for real-estate clients, so
  // the shell needs the flag for each linked business.
  const linkedIds = ctx.clients.map((c) => c.clientId)
  const flagRows = linkedIds.length
    ? await db
        .select({ id: clients.id, isRealEstateClient: clients.isRealEstateClient })
        .from(clients)
        .where(inArray(clients.id, linkedIds))
    : []
  const realEstateById = new Map(flagRows.map((r) => [r.id, r.isRealEstateClient]))

  return (
    <PortalShell
      role={user.normalizedRole === 'cpa' ? 'cpa' : 'client'}
      userName={`${user.firstName} ${user.lastName}`}
      clients={ctx.clients.map((c) => ({
        clientId: c.clientId,
        clientName: c.clientName,
        isRealEstateClient: realEstateById.get(c.clientId) ?? false,
        canMessage: c.capabilities.canMessage,
      }))}
      actingClientId={state.access?.clientId ?? null}
    >
      {needsSelection ? (
        <ChooseBusiness clients={ctx.clients} stale={state.selection === 'stale'} />
      ) : (
        children
      )}
    </PortalShell>
  )
}
