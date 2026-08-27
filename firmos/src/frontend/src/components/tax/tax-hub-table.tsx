import Link from 'next/link'

import type { TaxHub } from '@/server/tax'
import { WorkStatusBadge } from '@/shared/ui/work'

/**
 * Firm-wide year-end completion table (§18). Color carries state through the
 * 6-token contract: complete is the only success state, in-progress reads as
 * due_soon (work remains), and not-started is muted metadata. Counts are
 * tabular; the CPA-note indicator is a text glyph, never color-alone.
 */

export type HubStatus = 'not_started' | 'in_progress' | 'complete'

export function hubStatusOf(row: { completed: number; total: number }): HubStatus {
  if (row.total === 0 || row.completed === 0) return 'not_started'
  if (row.completed >= row.total) return 'complete'
  return 'in_progress'
}

function HubStatusChip({ status }: { status: HubStatus }) {
  if (status === 'complete') return <WorkStatusBadge status="on_track" label="Complete" />
  if (status === 'in_progress') return <WorkStatusBadge status="due_soon" label="In progress" />
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Not started
    </span>
  )
}

interface TaxHubTableProps {
  hub: TaxHub
  /** Client ids with at least one CPA note this year. */
  cpaNoteClientIds: ReadonlySet<number>
}

export function TaxHubTable({ hub, cpaNoteClientIds }: TaxHubTableProps) {
  if (hub.clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <h3 className="text-sm font-semibold text-foreground">No checklists for {hub.year} yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Checklists appear when a client&apos;s Tax tab is opened, or all at once with Populate all
          checklists.
        </p>
      </div>
    )
  }

  return (
    <table className="w-full text-sm" data-testid="tax-hub-table">
      <thead>
        <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <th className="px-4 py-2.5">Client</th>
          <th className="px-4 py-2.5 text-right">Items</th>
          <th className="px-4 py-2.5">Status</th>
          <th className="px-4 py-2.5">CPA notes</th>
        </tr>
      </thead>
      <tbody>
        {hub.clients.map((row) => (
          <tr
            key={row.clientId}
            data-testid="tax-hub-row"
            className="border-b border-border last:border-b-0"
          >
            <td className="px-4 py-2.5">
              <Link
                href={`/clients/${row.clientId}?tab=tax&year=${hub.year}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {row.clientName}
              </Link>
              {!row.isActive && (
                <span className="ml-2 text-[11px] font-medium text-muted-foreground">Inactive</span>
              )}
            </td>
            <td className="tnum px-4 py-2.5 text-right text-muted-foreground">
              <span className="font-semibold text-foreground">{row.completed}</span>
              {' / '}
              {row.total}
            </td>
            <td className="px-4 py-2.5">
              <HubStatusChip status={hubStatusOf(row)} />
            </td>
            <td className="px-4 py-2.5 text-xs text-muted-foreground">
              {cpaNoteClientIds.has(row.clientId) ? 'Has CPA notes' : '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
