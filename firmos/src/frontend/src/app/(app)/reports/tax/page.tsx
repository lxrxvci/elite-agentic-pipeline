import type { Metadata } from 'next'
import { and, eq, isNotNull } from 'drizzle-orm'

import { Card, CardContent } from '@/components/ui/card'
import { PopulateAllButton } from '@/components/tax/populate-all-button'
import { TaxHubTable } from '@/components/tax/tax-hub-table'
import { YearNav } from '@/components/tax/year-nav'
import { db } from '@/db'
import { yearEndTaxChecklists } from '@/db/schema'
import { requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getTaxHub } from '@/server/tax'

export const metadata: Metadata = { title: 'FirmOS - Year-End Tax' }
export const dynamic = 'force-dynamic'

function resolveYear(raw: string | undefined): number {
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed
  return localToday().year
}

/**
 * Firm-wide year-end tax hub (§18): per-client checklist completion for one
 * year. The December bulk populate is available to manager+ (the action
 * re-guards server-side). CPA-note presence is queried alongside the hub so
 * the table can flag clients whose CPA has weighed in.
 */
export default async function TaxHubPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const user = await requireStaff()
  const { year: rawYear } = await searchParams
  const year = resolveYear(rawYear)
  const canPopulate = ['manager', 'admin', 'owner'].includes(user.normalizedRole)

  const [hub, cpaNoteRows] = await Promise.all([
    getTaxHub(year),
    db
      .select({ clientId: yearEndTaxChecklists.clientId })
      .from(yearEndTaxChecklists)
      .where(and(eq(yearEndTaxChecklists.year, year), isNotNull(yearEndTaxChecklists.cpaNotes)))
      .groupBy(yearEndTaxChecklists.clientId),
  ])
  const cpaNoteClientIds = new Set(cpaNoteRows.map((r) => r.clientId))

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Year-end tax
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{hub.totals.completed}</span> of{' '}
            <span className="tnum">{hub.totals.items}</span> items complete across{' '}
            <span className="tnum">{hub.totals.clients}</span> clients
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canPopulate && <PopulateAllButton year={year} />}
          <YearNav year={year} />
        </div>
      </div>

      <Card>
        <CardContent className="px-0 pb-0 pt-0">
          <TaxHubTable hub={hub} cpaNoteClientIds={cpaNoteClientIds} />
        </CardContent>
      </Card>
    </div>
  )
}
