'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderKanban } from 'lucide-react'

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
import { Button } from '@/components/ui/button'
import type { ProjectListRow } from '@/server/projects'
import { fullDateLabel } from '@/components/clients/format'

import { CompletionMeter } from './completion-meter'
import { ProjectStatusChip, type ProjectStatusKey } from './project-status-chip'

/**
 * The /projects table (HANDOFF §20): one dense row per project - name,
 * client, status, billing mode, task counts, completion meter, created day.
 * Filters (status, client) are client-side derivations over the server
 * payload; the server stays the source of truth.
 */

type StatusFilter = 'all' | ProjectStatusKey

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const BILLING_LABELS: Record<string, string> = {
  project: 'Fixed price',
  tasks: 'Per task',
}

interface ProjectsTableProps {
  rows: ProjectListRow[]
  clients: { id: number; name: string }[]
}

export function ProjectsTable({ rows, clients }: ProjectsTableProps) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === 'all' || r.status === statusFilter) &&
          (clientFilter === 'all' || r.clientId === Number(clientFilter)),
      ),
    [rows, statusFilter, clientFilter],
  )

  const filtersActive = statusFilter !== 'all' || clientFilter !== 'all'

  function resetFilters() {
    setStatusFilter('all')
    setClientFilter('all')
  }

  function openProject(id: number) {
    router.push(`/projects/${id}`)
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <FolderKanban className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No projects yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Retroactive catch-up work and one-off consulting engagements live here. Create a
          project from a template, or let a catch-up name generate the account grid.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="h-8 w-48 text-xs" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
            Clear
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-semibold text-foreground">No projects match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">Clear a filter to see the full list.</p>
          <Button type="button" size="sm" className="mt-4 h-8" onClick={resetFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                  Project
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Client
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Status
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Billing
                </TableHead>
                <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Tasks
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Completion
                </TableHead>
                <TableHead className="h-9 px-4 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid="project-row"
                  data-project-id={row.id}
                  data-status={row.status}
                  tabIndex={0}
                  onClick={() => openProject(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openProject(row.id)
                    }
                  }}
                  className="h-12 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <TableCell className="px-4 py-0">
                    <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="truncate text-xs text-muted-foreground">{row.clientName}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <ProjectStatusChip status={row.status} />
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {BILLING_LABELS[row.billingMode] ?? row.billingMode}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-0 text-right">
                    <span className="tnum text-xs font-semibold text-foreground">{row.tasksDone}</span>
                    <span className="tnum text-xs text-muted-foreground">/{row.tasksTotal}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <CompletionMeter pct={row.completionPct} status={row.status} />
                  </TableCell>
                  <TableCell className="px-4 py-0 text-right">
                    <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
                      {row.createdAt ? fullDateLabel(row.createdAt) : ''}
                    </span>
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
