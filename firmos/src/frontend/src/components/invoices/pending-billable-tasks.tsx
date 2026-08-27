import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

import { moneyLabel } from '@/components/clients/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { PendingTaskRow } from './view-model'

/**
 * Unbilled completed billable tasks (HANDOFF §6.5) - the queue that keeps
 * billable work from slipping. Tasks without a price on the originating
 * recurring rule invoice at 0.00 until staff edits the draft line, so they
 * render with a due-soon warning, never silently.
 */
export function PendingBillableTasks({ rows }: { rows: PendingTaskRow[] }) {
  return (
    <section aria-label="Pending billable tasks" className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Pending billable tasks
        <span className="tnum font-semibold">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-4 text-xs text-muted-foreground">
          Nothing billable is waiting - every completed billable task is on an invoice.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 px-4 text-[11px] font-semibold uppercase tracking-wider">Client</TableHead>
                <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Task</TableHead>
                <TableHead className="h-8 px-3 text-[11px] font-semibold uppercase tracking-wider">Completed</TableHead>
                <TableHead className="h-8 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.taskId} className="h-10" data-testid="pending-task-row">
                  <TableCell className="max-w-52 px-4 py-0">
                    <Link
                      href={`/clients/${row.clientId}`}
                      className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {row.clientName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-72 px-3 py-0">
                    <span className="truncate text-sm text-foreground">{row.title}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
                      {row.completedLabel ?? 'No date'}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-0 text-right">
                    {row.unitPrice != null ? (
                      <span className="tnum text-sm font-semibold text-foreground">
                        {moneyLabel(row.unitPrice)}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1.5 rounded bg-status-due-soon-bg px-1.5 py-0.5 text-[11px] font-semibold text-status-due-soon"
                        data-testid="no-price-warning"
                      >
                        <TriangleAlert className="h-3 w-3" aria-hidden />
                        No price set
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
