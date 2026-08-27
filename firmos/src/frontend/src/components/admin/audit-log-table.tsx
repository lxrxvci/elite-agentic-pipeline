'use client'

import * as React from 'react'
import { Download, FileClock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { relativeTime } from '@/components/notifications/relative-time'
import type { AuditEventRow } from '@/server/admin-reads'

/**
 * /admin/audit - the append-only audit trail (HANDOFF §11). Filtering is a
 * pure client derivation over the server payload; CSV export downloads the
 * filtered view. Metadata renders as pretty JSON behind a disclosure so the
 * table stays dense.
 */

interface AuditLogTableProps {
  rows: AuditEventRow[]
  actions: string[]
  entityTypes: string[]
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function toCsv(rows: AuditEventRow[]): string {
  const header = 'time,user,action,entity_type,entity_id,metadata'
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.userName ?? '',
      r.action,
      r.entityType ?? '',
      r.entityId != null ? String(r.entityId) : '',
      r.details == null ? '' : JSON.stringify(r.details),
    ]
      .map(csvEscape)
      .join(','),
  )
  return [header, ...lines].join('\n')
}

export function AuditLogTable({ rows, actions, entityTypes }: AuditLogTableProps) {
  const [actionFilter, setActionFilter] = React.useState('all')
  const [entityFilter, setEntityFilter] = React.useState('all')

  const filtered = rows.filter(
    (r) =>
      (actionFilter === 'all' || r.action === actionFilter) &&
      (entityFilter === 'all' || r.entityType === entityFilter),
  )

  function downloadCsv() {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-8 w-52 text-xs" aria-label="Filter by action">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="h-8 w-52 text-xs" aria-label="Filter by entity">
            <SelectValue placeholder="All entities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {entityTypes.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-8 text-xs"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
        >
          <Download aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Export CSV (<span className="tnum">{filtered.length}</span>)
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <FileClock className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No audit events</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            {rows.length === 0
              ? 'Every mutation writes here; nothing has happened yet.'
              : 'No events match these filters - widen them to see the trail.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Time</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">User</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Action</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">Entity</TableHead>
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} data-testid="audit-row" className="hover:bg-transparent">
                  <TableCell className="whitespace-nowrap px-4 py-2">
                    <div className="flex flex-col">
                      <span className="tnum text-xs text-foreground">
                        {row.createdAt.toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {relativeTime(row.createdAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs text-foreground">
                    {row.userName ?? <span className="text-muted-foreground">system</span>}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-foreground">
                      {row.action}
                    </code>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                    {row.entityType != null ? (
                      <>
                        {row.entityType}
                        {row.entityId != null && (
                          <span className="tnum"> #{row.entityId}</span>
                        )}
                      </>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 px-4 py-2">
                    {row.details == null ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          View
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-secondary p-2 text-[11px] leading-relaxed text-foreground">
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
