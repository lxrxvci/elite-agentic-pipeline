'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Search, Users } from 'lucide-react'
import type { ClientWorkState } from '@firmos/domain'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ClientListRow, StaffRef } from '@/server/clients'
import { avatarStyle } from '@/shared/lib/avatar-hue'
import { cn } from '@/shared/lib/utils'
import { HealthRing } from '@/shared/ui/work'
import type { WorkStatus } from '@/shared/ui/work'

import { cadenceLabel, cadenceTierLabel, moneyLabel } from './format'
import { filterClients, sortClients, type SortDir, type SortKey } from './list-view-model'
import { ClientStateChip } from './state-chip'

/**
 * The /clients table (docs/DESIGN_MANDATE.md - Stripe discipline): one dense
 * row per client, 48px tall, muted metadata, color only ever means state.
 * Sorting and filtering are pure client-side derivations over the server
 * payload; the server stays the source of truth.
 */

type StateFilter = 'all' | ClientWorkState
type CadenceFilter = 'all' | string

const HEALTH_STATUS: Record<'overdue' | 'up_to_date' | 'in_progress', WorkStatus> = {
  overdue: 'overdue',
  up_to_date: 'on_track',
  in_progress: 'due_soon',
}

const STATE_FILTER_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All states' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'project_only', label: 'Project' },
  { value: 'inactive', label: 'Inactive' },
]

interface ClientsTableProps {
  rows: ClientListRow[]
  /** Admin/owner only: shows the Eff. $/hr column (billing content, §10). */
  canSeeRates?: boolean
}

function StaffAvatar({ person, role }: { person: StaffRef; role: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className="h-6 w-6">
          <AvatarFallback className="text-[10px] font-semibold" style={avatarStyle(person.id)}>
            <span className="sr-only">{`${role}: ${person.name}`}</span>
            <span aria-hidden>{person.initials}</span>
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{`${role}: ${person.name}`}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Health cell: the ring is the hero number of the row. Extremes (at-risk
 * overdue, or 90+ fully healthy) get a subtly larger ring on a status-tinted
 * disc so the spectrum reads peripherally down the column.
 */
function HealthCell({ score, status }: { score: number; status: WorkStatus }) {
  const extreme = status === 'overdue' || score >= 90
  return (
    <span
      className={cn(
        'inline-flex rounded-full p-0.5',
        extreme && (status === 'overdue' ? 'bg-status-overdue-bg' : 'bg-status-on-track-bg'),
      )}
    >
      <HealthRing score={score} status={status} size={extreme ? 34 : 30} />
    </span>
  )
}

export function ClientsTable({ rows, canSeeRates = false }: ClientsTableProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const cadenceOptions = useMemo(
    () => [...new Set(rows.map((r) => r.bookkeepingFrequency))].sort(),
    [rows],
  )

  const assigneeOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const r of rows) {
      if (r.manager) byId.set(r.manager.id, r.manager.name)
      if (r.bookkeeper) byId.set(r.bookkeeper.id, r.bookkeeper.name)
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(
    () =>
      filterClients(rows, {
        search,
        state: stateFilter,
        cadence: cadenceFilter,
        assigneeId: assigneeFilter,
      }),
    [rows, search, stateFilter, cadenceFilter, assigneeFilter],
  )

  const sorted = useMemo(
    () => sortClients(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  )

  const filtersActive =
    search.trim() !== '' || stateFilter !== 'all' || cadenceFilter !== 'all' || assigneeFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setStateFilter('all')
    setCadenceFilter('all')
    setAssigneeFilter('all')
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  function openClient(id: number) {
    router.push(`/clients/${id}`)
  }

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? (
      <ArrowUpDown className="h-3 w-3" aria-hidden />
    ) : sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden />
    )

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <Users className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No clients yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Client records appear here once an intake converts. Health rings, lifecycle
          state, and open work counts render in one dense, scannable list.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by state">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            {STATE_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cadenceFilter} onValueChange={setCadenceFilter}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by cadence">
            <SelectValue placeholder="All cadences" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cadences</SelectItem>
            {cadenceOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {cadenceLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by assignee">
            <SelectValue placeholder="All staff" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            {assigneeOptions.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
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

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-semibold text-foreground">No clients match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Widen the search or clear a filter to see the full list.
          </p>
          <Button type="button" size="sm" className="mt-4 h-8" onClick={resetFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4" aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    Client {sortIcon('name')}
                  </button>
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  State
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Cadence
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Team
                </TableHead>
                {canSeeRates && (
                  <TableHead className="h-9 px-3 text-right text-[11px] font-semibold uppercase tracking-wider">
                    Eff. $/hr
                  </TableHead>
                )}
                <TableHead className="h-9 px-3 text-right" aria-sort={sortKey === 'work' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => toggleSort('work')}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    Open work {sortIcon('work')}
                  </button>
                </TableHead>
                <TableHead className="h-9 px-4 text-right" aria-sort={sortKey === 'health' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => toggleSort('health')}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    Health {sortIcon('health')}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid="client-row"
                  data-client-id={row.id}
                  data-state={row.state}
                  tabIndex={0}
                  onClick={() => openClient(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openClient(row.id)
                    }
                  }}
                  className="h-12 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <TableCell className="px-4 py-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex min-w-0 flex-col justify-center">
                        <span className="truncate text-sm font-medium text-foreground">
                          {row.dbaName ?? row.legalName}
                        </span>
                        {row.dbaName && (
                          <span className="truncate text-xs text-muted-foreground">{row.legalName}</span>
                        )}
                      </div>
                      {/* Close streak (Progress board language): earned marker
                          only - 3+ closed periods in a row, icon + count,
                          never color alone. */}
                      {row.closeStreak >= 3 && (
                        <span
                          data-testid="streak-badge"
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-on-track-bg px-1.5 py-0.5 text-[10px] font-semibold text-status-on-track"
                        >
                          <Check className="h-2.5 w-2.5" aria-hidden />
                          <span className="tnum">{row.closeStreak}</span> in a row
                        </span>
                      )}
                    </div>
                  </TableCell>                  <TableCell className="px-3 py-0">
                    <ClientStateChip state={row.state} />
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {cadenceTierLabel(row.bookkeepingFrequency, row.monthlyCloseTier)}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <div className="flex items-center -space-x-1.5">
                      {row.manager && <StaffAvatar person={row.manager} role="Manager" />}
                      {row.bookkeeper && <StaffAvatar person={row.bookkeeper} role="Bookkeeper" />}
                      {!row.manager && !row.bookkeeper && (
                        <span className="text-xs text-muted-foreground">Unassigned</span>
                      )}
                    </div>
                  </TableCell>
                  {canSeeRates && (
                    <TableCell className="px-3 py-0 text-right">
                      {row.effectiveHourlyRate != null ? (
                        <span className="tnum text-xs text-muted-foreground">
                          {moneyLabel(row.effectiveHourlyRate)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="px-3 py-0 text-right">
                    <span
                      className={cn(
                        'tnum text-sm font-semibold',
                        row.openWorkCount > 0 ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {row.openWorkCount}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <div className="flex items-center justify-end">
                      {row.health ? (
                        <HealthCell
                          score={row.health.score}
                          status={HEALTH_STATUS[row.health.status]}
                        />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-xs text-muted-foreground">Not scored</span>
                          </TooltipTrigger>
                          <TooltipContent>On hold - health is never scored while paused or inactive</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
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
