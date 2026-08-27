import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, FileText } from 'lucide-react'

import { CpaWriteActions } from '@/components/portal/cpa-write-actions'
import { PortalDocumentTable } from '@/components/portal/document-table'
import { requireCpaRolePage } from '@/components/portal/server'
import { PortalStatementsGrid } from '@/components/portal/statements-grid'
import { CHANGE_FIELD_LABELS, CHANGE_REQUEST_META } from '@/components/portal/status'
import { localToday } from '@/server/dates'
import { getDocumentTree } from '@/server/documents'
import {
  PortalError,
  getCpaClientDetail,
  getPortalProfile,
} from '@/server/portal'
import { getStatementsGrid } from '@/server/statements'
import { monthLabel } from '@/shared/lib/date-display'
import { WorkStatusBadge } from '@/shared/ui/work'

export const metadata: Metadata = { title: 'Client detail - FirmOS portal' }

/**
 * CPA client detail (HANDOFF §12): read-only profile, reports with
 * download, the statements grid, and tax documents, plus the three CPA
 * writes (change request, tax-document request, team request). The client
 * id from the URL is validated against the CPA's linked set by the engine
 * on every call; downloads are additionally folder-prefix scoped in the
 * API route.
 */
export default async function CpaClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const state = await requireCpaRolePage()
  const { clientId: raw } = await params
  const clientId = Number(raw)
  if (!Number.isInteger(clientId) || clientId <= 0) notFound()

  let detail
  let profile
  try {
    ;[detail, profile] = await Promise.all([
      getCpaClientDetail(state.user, clientId),
      getPortalProfile(state.user, clientId),
    ])
  } catch (error) {
    if (error instanceof PortalError) notFound()
    throw error
  }

  const [grid, tree] = await Promise.all([
    getStatementsGrid(clientId, localToday()),
    getDocumentTree(clientId),
  ])
  const taxDocuments = tree.documentsByGroup.tax
  const clientName = detail.client.dbaName ?? detail.client.legalName

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/portal/cpa" className="text-[13px] text-primary hover:underline">
          All clients
        </Link>
        <h1 className="mt-1 font-display text-xl font-semibold tracking-tight">{clientName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <span className="capitalize">{detail.client.bookkeepingFrequency}</span> books · read-only
          access
        </p>
      </div>

      <section aria-label="Client profile" className="rounded-lg border border-border bg-card px-4 py-3">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {(
            [
              ['Legal name', detail.client.legalName],
              ['Tax structure', detail.client.taxStructure],
              ['Tax ID', detail.client.taxId],
              ['Accounting method', detail.client.accountingMethod],
              ['Bookkeeping frequency', detail.client.bookkeepingFrequency],
              ['Billing frequency', detail.client.billingFrequency],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium capitalize text-foreground">{value ?? 'Not set'}</dd>
            </div>
          ))}
        </dl>
        {profile.pendingChangeRequests.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
            {profile.pendingChangeRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <WorkStatusBadge
                  status={CHANGE_REQUEST_META.pending.status}
                  label={CHANGE_REQUEST_META.pending.label}
                />
                <span className="text-muted-foreground">
                  {CHANGE_FIELD_LABELS[request.fieldName] ?? request.fieldName}:{' '}
                  {request.oldValue ?? 'Not set'} to{' '}
                  <span className="font-medium text-foreground">{request.newValue}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cpa-reports">
        <h2 id="cpa-reports" className="mb-2 text-sm font-semibold">
          Reports
        </h2>
        {detail.reports.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            No reports on file for this client yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Report</th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">Period</th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.reports.map((report) => (
                  <tr key={report.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium text-foreground">{report.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {monthLabel(report.attributedYear, report.attributedMonth)}
                    </td>
                    <td className="px-3 py-2">
                      {report.isComplete ? (
                        <WorkStatusBadge status="on_track" label="Delivered" />
                      ) : (
                        <WorkStatusBadge status="due_soon" label="In progress" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {report.documentId != null ? (
                        <a
                          href={`/api/documents/${report.documentId}`}
                          aria-label={`Download ${report.name} for ${monthLabel(report.attributedYear, report.attributedMonth)}`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-primary hover:bg-accent hover:underline"
                        >
                          <Download aria-hidden className="h-3.5 w-3.5" />
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">No file yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="cpa-statements">
        <h2 id="cpa-statements" className="mb-2 text-sm font-semibold">
          Statements
        </h2>
        <PortalStatementsGrid
          grid={grid}
          canUpload={false}
          readOnlyNote="Statements are read-only for CPA sign-ins. The client or the firm uploads them."
        />
      </section>

      <section aria-labelledby="cpa-tax-documents">
        <h2 id="cpa-tax-documents" className="mb-2 text-sm font-semibold">
          Tax documents
        </h2>
        {taxDocuments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            No tax documents on file. Need one? Send a tax document request below.
          </p>
        ) : (
          <PortalDocumentTable documents={taxDocuments} />
        )}
      </section>

      <section aria-labelledby="cpa-write-actions">
        <h2 id="cpa-write-actions" className="mb-2 text-sm font-semibold">
          Requests
        </h2>
        <CpaWriteActions clientId={clientId} />
      </section>
    </div>
  )
}
