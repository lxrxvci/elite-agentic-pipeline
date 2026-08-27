import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { PortalPropertiesView } from '@/components/portal/properties-view'
import { requireClientRolePage } from '@/components/portal/server'
import { YearNav } from '@/components/tax/year-nav'
import { db } from '@/db'
import { clients } from '@/db/schema'
import { localToday } from '@/server/dates'
import { getProformaStatus } from '@/server/properties'

export const metadata: Metadata = { title: 'Portal properties - FirmOS' }

/**
 * Portal properties (HANDOFF §12/§20): pro-forma entry per property per
 * year. Real-estate clients only - any other acting client 404s here, same
 * as the nav item never rendering for them. Saving through the portal path
 * marks the row portal-submitted and re-checks the auto-complete rule.
 */
export default async function PortalPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { access } = await requireClientRolePage()
  if (!access) return null

  const [client] = await db
    .select({ isRealEstateClient: clients.isRealEstateClient })
    .from(clients)
    .where(eq(clients.id, access.clientId))
    .limit(1)
  if (!client?.isRealEstateClient) notFound()

  const { year: rawYear } = await searchParams
  const parsed = Number(rawYear)
  const today = localToday()
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : today.year + 1

  const status = await getProformaStatus(access.clientId, year)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Properties</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pro-forma figures per property for {access.clientName}.
          </p>
        </div>
        <YearNav year={year} />
      </div>

      <PortalPropertiesView clientId={access.clientId} year={year} status={status} />
    </div>
  )
}
