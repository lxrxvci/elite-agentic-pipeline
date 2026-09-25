import type { Metadata } from 'next'
import { CalendarRange, CalendarX } from 'lucide-react'

import { PortalReportsCalendar } from '@/components/portal/reports-calendar'
import { requireClientRolePage } from '@/components/portal/server'
import { localToday } from '@/server/dates'
import { getPortalReportsCalendar } from '@/server/portal-progress'

export const metadata: Metadata = { title: 'Portal reports - FirmOS' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Portal reports (HANDOFF §12, Wave 4): the acting client's report year as
 * status cells - delivered reads green with a check, an undelivered month
 * past its due date reads behind, scheduled months stay muted - with
 * downloads through the portal-scoped API route. Expected months and
 * delivered truth come from the same client_reports schedule the staff
 * year grid scores. I6: a contact whose link opts out of reports (the
 * intake's per-owner "receives reports" checkbox) gets the disabled state
 * instead - the read itself is also gated, so a direct URL visit leaks
 * nothing.
 */
export default async function PortalReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { access, state } = await requireClientRolePage()
  if (!access) return null

  if (!access.capabilities.canViewReports) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <CalendarX className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-foreground">
            Reports are not delivered to your contact
          </h2>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {access.clientName} has report delivery set to other contacts. Ask your bookkeeping
            team if you should be receiving reports too.
          </p>
        </div>
      </div>
    )
  }

  const { year: rawYear } = await searchParams
  const today = localToday()
  const parsedYear = Number(rawYear)
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : today.year

  const cells = await getPortalReportsCalendar(state.user, access.clientId, year, today)
  const hasAnyWork = cells.some((c) => c.state !== 'no_work')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reports your firm has delivered for {access.clientName}, by month.
        </p>
      </div>

      {!hasAnyWork ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <CalendarRange aria-hidden className="h-5 w-5 text-accent-foreground" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">No reports scheduled for {year}</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            When your firm delivers a report, its month turns green here with a download link.
          </p>
        </div>
      ) : (
        <PortalReportsCalendar
          year={year}
          cells={cells}
          prevYearHref={`/portal/reports?year=${year - 1}`}
          nextYearHref={`/portal/reports?year=${year + 1}`}
        />
      )}
    </div>
  )
}
