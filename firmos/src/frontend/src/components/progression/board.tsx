'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft, ChevronRight, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cadenceLabel } from '@/components/clients/format'
import {
  STREAM_KIND,
  STREAM_LABEL,
  YEAR_GRID_CELL_META,
  YearGridLegend,
} from '@/components/clients/year-grid'
import { KIND_META, KIND_STYLE } from '@/components/workstation/work-card'
import type {
  FirmProgressionBoard,
  ProgressionCell,
  ProgressionRow,
  ProgressionStreamSummary,
} from '@/server/progression'
import type { WorkCardKind } from '@/server/queue'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { HealthRing } from '@/shared/ui/work'
import type { WorkStatus } from '@/shared/ui/work'

/**
 * The Firm Progression Board (FIRMOS-VISUAL-ELITE-PLAN Wave 2): every scored
 * client x Jan-Dec on one heatmap. Cell language is the year grid's - the
 * 6-token status set, full-cell tint, always an icon, never color alone -
 * rolled up to the client level so a whole green month means every stream
 * closed. Rows keep their identity furniture (health ring, cadence, close
 * streak); the footer carries the firm-wide completion per month.
 */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const HEALTH_STATUS: Record<'overdue' | 'up_to_date' | 'in_progress', WorkStatus> = {
  overdue: 'overdue',
  up_to_date: 'on_track',
  in_progress: 'due_soon',
}

/** Streams present on the row this year, in year-grid order (kind identity dots). */
const BOARD_STREAMS: WorkCardKind[] = ['bank_feed', 'reconciliation', 'report', 'task']

/** "2 of 3 done" / "Done" / "1 overdue" - the per-stream tooltip clause. */
function streamSummary(s: ProgressionStreamSummary): string {
  if (s.total === 0) return 'No work'
  const parts =
    s.state === 'complete' ? ['Done'] : [`${s.completed} of ${s.total} done`]
  if (s.waiting > 0) parts.push(`${s.waiting} waiting`)
  if (s.overdue > 0) parts.push(`${s.overdue} overdue`)
  return parts.join(', ')
}

function cellAriaLabel(row: ProgressionRow, cell: ProgressionCell, year: number): string {
  const meta = YEAR_GRID_CELL_META[cell.state]
  if (!cell.onCadence) {
    return `${row.name}, ${monthLabel(year, cell.month)}: ${cadenceLabel(row.frequency)} cadence, no period closes this month`
  }
  const streams = cell.streams
    .filter((s) => s.total > 0)
    .map((s) => `${STREAM_LABEL[s.stream]} ${YEAR_GRID_CELL_META[s.state].label.toLowerCase()}`)
  return `${row.name}, ${monthLabel(year, cell.month)}: ${meta.label}${
    streams.length > 0 ? `. ${streams.join(', ')}` : ''
  }`
}

/** Rich tooltip: the per-stream breakdown that answers "are my reports ready?" */
function CellBreakdown({ row, cell, year }: { row: ProgressionRow; cell: ProgressionCell; year: number }) {
  if (!cell.onCadence) {
    return (
      <span className="text-xs">
        {cadenceLabel(row.frequency)} cadence: no period closes in {MONTH_SHORT[cell.month - 1]}.
      </span>
    )
  }
  if (cell.streams.every((s) => s.total === 0)) {
    return <span className="text-xs">Nothing generated for this period.</span>
  }
  return (
    <div className="min-w-52 space-y-1.5 py-0.5">
      <p className="text-[11px] font-semibold text-popover-foreground">
        {row.name} · {monthLabel(year, cell.month)}
      </p>
      {cell.streams.map((s) => {
        const { Icon } = KIND_META[STREAM_KIND[s.stream]]
        return (
          <div key={s.stream} className="flex items-center gap-1.5 text-[11px]">
            <span
              aria-hidden
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded',
                KIND_STYLE[STREAM_KIND[s.stream]].chip,
              )}
            >
              <Icon className="h-2.5 w-2.5" aria-hidden />
            </span>
            <span className="text-popover-foreground">{STREAM_LABEL[s.stream]}</span>
            <span className="tnum ml-auto pl-3 text-muted-foreground">{streamSummary(s)}</span>
          </div>
        )
      })}
    </div>
  )
}

function BoardCell({ row, cell, year }: { row: ProgressionRow; cell: ProgressionCell; year: number }) {
  const meta = YEAR_GRID_CELL_META[cell.state]
  const clickable = cell.state !== 'no_work'
  const label = cellAriaLabel(row, cell, year)
  const classes = cn(
    'flex h-9 w-full items-center justify-center rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    meta.classes,
    clickable && 'hover:ring-1 hover:ring-ring/60',
    !clickable && 'cursor-default',
  )
  const icon =
    meta.Icon == null ? (
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
    ) : (
      <meta.Icon className="h-3.5 w-3.5" aria-hidden />
    )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {clickable ? (
          <Link
            href={`/clients/${row.clientId}?tab=work&year=${year}`}
            aria-label={label}
            data-testid="progression-cell"
            data-client-id={row.clientId}
            data-state={cell.state}
            data-month={cell.month}
            className={classes}
          >
            {icon}
          </Link>
        ) : (
          <span
            aria-label={label}
            data-testid="progression-cell"
            data-client-id={row.clientId}
            data-state={cell.state}
            data-month={cell.month}
            className={classes}
          >
            {icon}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <CellBreakdown row={row} cell={cell} year={year} />
      </TooltipContent>
    </Tooltip>
  )
}

/** Sticky name cell: health ring, name, cadence, streak badge, kind stream dots. */
function ClientCell({ row }: { row: ProgressionRow }) {
  const presentKinds = BOARD_STREAMS.filter((kind) =>
    row.cells.some((c) => c.streams.some((s) => STREAM_KIND[s.stream] === kind && s.total > 0)),
  )
  return (
    <div className="sticky left-0 z-10 flex items-center gap-2.5 border-r border-border bg-card py-1 pl-3 pr-3 transition-colors duration-150 group-hover:bg-muted/60">
      {row.health ? (
        <HealthRing score={row.health.score} status={HEALTH_STATUS[row.health.status]} size={30} />
      ) : (
        <span
          role="img"
          aria-label="Client health not scored"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
        >
          n/a
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/clients/${row.clientId}`}
            className="truncate text-[13px] font-medium text-foreground hover:underline"
          >
            {row.name}
          </Link>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{cadenceLabel(row.frequency)}</span>
          {row.streak >= 3 && (
            <span
              data-testid="streak-badge"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-on-track-bg px-1.5 py-0.5 text-[10px] font-semibold text-status-on-track"
            >
              <Check className="h-2.5 w-2.5" aria-hidden />
              <span className="tnum">{row.streak}</span> in a row
            </span>
          )}
          <span
            className="ml-0.5 inline-flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={`Streams: ${presentKinds.map((k) => KIND_META[k].label).join(', ') || 'none'}`}
          >
            {presentKinds.map((kind) => (
              <span
                key={kind}
                aria-hidden
                className={cn('h-1.5 w-1.5 rounded-full bg-current', KIND_STYLE[kind].chip.split(' ')[1])}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ProgressionBoard({ board }: { board: FirmProgressionBoard }) {
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [cadenceFilter, setCadenceFilter] = useState('all')
  const [needsAttention, setNeedsAttention] = useState(false)

  const assigneeOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const r of board.rows) {
      if (r.manager) byId.set(r.manager.id, r.manager.name)
      if (r.bookkeeper) byId.set(r.bookkeeper.id, r.bookkeeper.name)
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [board.rows])

  const cadenceOptions = useMemo(
    () => [...new Set(board.rows.map((r) => r.frequency))].sort(),
    [board.rows],
  )

  const filtered = useMemo(
    () =>
      board.rows.filter((r) => {
        if (needsAttention && !r.needsAttention) return false
        if (cadenceFilter !== 'all' && r.frequency !== cadenceFilter) return false
        if (assigneeFilter !== 'all') {
          const id = Number(assigneeFilter)
          if (r.manager?.id !== id && r.bookkeeper?.id !== id) return false
        }
        return true
      }),
    [board.rows, needsAttention, cadenceFilter, assigneeFilter],
  )

  const attentionCount = board.rows.filter((r) => r.needsAttention).length
  const filtersActive = assigneeFilter !== 'all' || cadenceFilter !== 'all' || needsAttention

  function resetFilters() {
    setAssigneeFilter('all')
    setCadenceFilter('all')
    setNeedsAttention(false)
  }

  if (board.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <Users className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No clients on the board yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Every active client appears here as a row of months. Paused and inactive clients stay
          off the board until they return.
        </p>
      </div>
    )
  }

  return (
    <section aria-label={`${board.year} firm progression board`} className="space-y-3">
      {/* Year nav + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/progress?year=${board.year - 1}`}
            aria-label="Previous year"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="tnum font-display text-base font-semibold tracking-tight text-foreground">
            {board.year}
          </span>
          <Link
            href={`/progress?year=${board.year + 1}`}
            aria-label="Next year"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">
            <span className="tnum font-semibold text-foreground">{board.rows.length}</span> clients
            {attentionCount > 0 && (
              <>
                {' · '}
                <span className="tnum font-semibold text-status-overdue">{attentionCount}</span> need
                attention
              </>
            )}
          </span>
        </div>
        <YearGridLegend />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by team member">
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

        <button
          type="button"
          aria-pressed={needsAttention}
          data-testid="needs-attention-toggle"
          onClick={() => setNeedsAttention((v) => !v)}
          className={cn(
            'h-8 rounded-md border px-3 text-xs font-semibold transition-colors duration-150',
            needsAttention
              ? 'border-status-overdue/40 bg-status-overdue-bg text-status-overdue'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          Needs attention
        </button>

        {filtersActive && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* The heatmap */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-semibold text-foreground">No clients match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Widen a filter or clear them all to see the full board.
          </p>
          <Button type="button" size="sm" className="mt-4 h-8" onClick={resetFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div
          data-testid="progression-board"
          className="overflow-x-auto rounded-xl border border-border bg-card"
        >
          <div
            className="grid min-w-[920px] gap-1"
            style={{ gridTemplateColumns: 'minmax(13rem, 15rem) repeat(12, minmax(0, 1fr))' }}
          >
            {/* Header: sticky month labels over a sticky first column. */}
            <div className="sticky left-0 top-0 z-30 border-r border-border bg-card pb-1 pl-3 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Client
            </div>
            {board.months.map((m) => (
              <div
                key={m}
                className="sticky top-0 z-20 bg-card pb-1 pt-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {MONTH_SHORT[m - 1]}
              </div>
            ))}
            <div className="col-span-full border-b border-border" aria-hidden />

            {filtered.map((row) => (
              <div key={row.clientId} className="group contents" data-testid="progression-row">
                <ClientCell row={row} />
                {row.cells.map((cell) => (
                  <div key={cell.month} className="py-1">
                    <BoardCell row={row} cell={cell} year={board.year} />
                  </div>
                ))}
              </div>
            ))}

            {/* Footer: firm-wide completion per month. */}
            <div className="col-span-full border-t border-border" aria-hidden />
            <div className="sticky bottom-0 left-0 z-30 border-r border-border bg-card pb-3 pl-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Firm completion
            </div>
            {board.columnCompletion.map((pct, i) => (
              <div
                key={board.months[i]}
                data-testid="column-completion"
                data-month={board.months[i]}
                className="sticky bottom-0 z-20 bg-card pb-3 pt-1 text-center"
              >
                {pct == null ? (
                  <span className="text-[11px] text-muted-foreground" aria-label={`${MONTH_SHORT[i]}: no work attributed`}>
                    ·
                  </span>
                ) : (
                  <span
                    className={cn(
                      'tnum text-[11px] font-semibold',
                      pct === 100 ? 'text-status-on-track' : 'text-foreground',
                    )}
                    aria-label={`${MONTH_SHORT[i]}: ${pct}% complete`}
                  >
                    {pct}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
