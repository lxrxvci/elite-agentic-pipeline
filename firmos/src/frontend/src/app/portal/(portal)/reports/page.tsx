import type { Metadata } from 'next'
import { CalendarRange, Download, FileText } from 'lucide-react'

import { requireClientRolePage } from '@/components/portal/server'
import { getDocumentTree, type DocumentRow } from '@/server/documents'
import { monthLabel } from '@/shared/lib/date-display'

export const metadata: Metadata = { title: 'Portal reports - FirmOS' }

/**
 * Portal reports (HANDOFF §12): delivered report documents arranged as a
 * by-month calendar, with download through the portal-scoped API route.
 * Reports attribute to their accounting month when the firm set one, else
 * to the upload month.
 */

function periodOf(doc: DocumentRow): { year: number; month: number } {
  if (doc.attributedYear != null && doc.attributedMonth != null) {
    return { year: doc.attributedYear, month: doc.attributedMonth }
  }
  return { year: doc.createdAt.getFullYear(), month: doc.createdAt.getMonth() + 1 }
}

export default async function PortalReportsPage() {
  const { access } = await requireClientRolePage()
  if (!access) return null

  const tree = await getDocumentTree(access.clientId)
  const reports = tree.documentsByGroup.reports

  const byPeriod = new Map<string, { year: number; month: number; docs: DocumentRow[] }>()
  for (const doc of reports) {
    const period = periodOf(doc)
    const key = `${period.year}-${period.month}`
    const entry = byPeriod.get(key) ?? { ...period, docs: [] }
    entry.docs.push(doc)
    byPeriod.set(key, entry)
  }
  const periods = [...byPeriod.values()].sort((a, b) => b.year - a.year || b.month - a.month)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reports your firm has delivered for {access.clientName}, by month.
        </p>
      </div>

      {periods.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <CalendarRange aria-hidden className="h-5 w-5 text-accent-foreground" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">No reports delivered yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            When your firm delivers a report, it lands here under its month with a download link.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {periods.map((period) => (
            <section
              key={`${period.year}-${period.month}`}
              aria-label={monthLabel(period.year, period.month)}
              className="rounded-lg border border-border bg-card p-4"
            >
              <h2 className="text-sm font-semibold">{monthLabel(period.year, period.month)}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {period.docs.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13px]">
                      <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{doc.fileName}</span>
                    </span>
                    <a
                      href={`/api/documents/${doc.id}`}
                      aria-label={`Download ${doc.fileName}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent hover:underline"
                    >
                      <Download aria-hidden className="h-3 w-3" />
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
