'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  PauseCircle,
} from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorkCardKind } from '@/server/queue'
import type {
  ClientYearGrid,
  YearGridCell,
  YearGridCellState,
  YearGridStream,
} from '@/server/year-grid'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { KIND_META, KIND_STYLE } from '@/components/workstation/work-card'

/**
 * The per-client year progress grid: streams as rows, cadence periods as
 * columns, one cell per stream x period. Cell language mirrors the
 * statements grid (HANDOFF §14 precedent): full-cell background tint from
 * the 6-token status set, always paired with an icon and an accessible
 * label - never color alone. The whole-month green flip on completion is
 * the hero state and gets a short settle animation (reduced-motion safe).
 */

/** Stream -> the work-card kind the Work list filters by (drill-down). */
export const STREAM_KIND: Record<YearGridStream, WorkCardKind> = {
  bank_feeds: 'bank_feed',
  reconciliations: 'reconciliation',
  reports: 'report',
  tasks: 'task',
}

export const STREAM_LABEL: Record<YearGridStream, string> = {
  bank_feeds: 'Bank feeds',
  reconciliations: 'Reconciliations',
  reports: 'Reports',
  tasks: 'Tasks',
}

interface CellMeta {
  label: string
  /** Null renders a plain status dot (the not_due state). */
  Icon: typeof Check | null
  classes: string
}

export const YEAR_GRID_CELL_META: Record<YearGridCellState, CellMeta> = {
  complete: {
    label: 'Complete',
    Icon: Check,
    classes: 'bg-status-on-track-bg text-status-on-track',
  },
  in_progress: {
    label: 'In progress',
    Icon: Clock,
    classes: 'bg-status-due-soon-bg text-status-due-soon',
  },
  behind: {
    label: 'Behind',
    Icon: AlertCircle,
    classes: 'bg-status-overdue-bg text-status-overdue',
  },
  waiting: {
    label: 'Waiting on client',
    Icon: PauseCircle,
    classes: 'bg-status-waiting-client-bg text-status-waiting-client',
  },
  not_due: {
    label: 'Not due yet',
    Icon: null,
    classes: 'bg-muted text-muted-foreground',
  },
  no_work: {
    label: 'No work',
    Icon: CircleDashed,
    classes: 'border border-dashed border-border text-muted-foreground',
  },
}

export const YEAR_GRID_CELL_STATES: YearGridCellState[] = [
  'complete',
  'in_progress',
  'behind',
  'waiting',
  'not_due',
  'no_work',
]

/** "Bank feeds" already plural; use the count-noun the tooltip sentence needs. */
const STREAM_NOUN: Record<YearGridStream, string> = {
  bank_feeds: 'feeds',
  reconciliations: 'reconciliations',
  reports: 'reports',
  tasks: 'tasks',
}

/** "3 of 4 feeds done, 1 waiting on client" - the counts sentence. */
function countsSentence(cell: YearGridCell): string {
  if (cell.state === 'no_work') return 'nothing generated for this period'
  if (cell.state === 'not_due' && cell.total === 0) return 'nothing due yet'
  const parts = [`${cell.completed} of ${cell.total} ${STREAM_NOUN[cell.stream]} done`]
  if (cell.waiting > 0) parts.push(`${cell.waiting} waiting on client`)
  if (cell.overdue > 0) parts.push(`${cell.overdue} overdue`)
  return parts.join(', ')
}

function cellAriaLabel(cell: YearGridCell): string {
  const meta = YEAR_GRID_CELL_META[cell.state]
  return `${STREAM_LABEL[cell.stream]}, ${monthLabel(cell.year, cell.month)}: ${meta.label}, ${countsSentence(cell)}`
}

function cellKey(cell: Pick<YearGridCell, 'stream' | 'year' | 'month'>): string {
  return `${cell.stream}:${cell.year}-${cell.month}`
}

export interface YearGridFilter {
  kind: WorkCardKind
  stream: YearGridStream
  year: number
  /** Column month (period end). */
  month: number
  /** Source months the column aggregates - the list filter matches on these. */
  months: number[]
  label: string
}

interface YearGridProps {
  grid: ClientYearGrid
  /** Currently drilled-into cell; null shows the full Work list. */
  filter: YearGridFilter | null
  onCellClick: (filter: YearGridFilter | null) => void
  prevYearHref: string
  nextYearHref: string
}

function StateIcon({ meta }: { meta: CellMeta }) {
  if (meta.Icon == null) {
    return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
  }
  return <meta.Icon className="h-3.5 w-3.5" aria-hidden />
}

export function YearGrid({ grid, filter, onCellClick, prevYearHref, nextYearHref }: YearGridProps) {
  // Dopamine settle: when a cell flips to complete, pop it briefly. The ref
  // seeds on mount so the first paint never animates; only true transitions
  // into complete (same cell, previously not complete) celebrate.
  const prevStates = useRef<Map<string, YearGridCellState> | null>(null)
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set())

  useEffect(() => {
    const next = new Map<string, YearGridCellState>()
    for (const row of grid.rows) {
      for (const cell of row.cells) next.set(cellKey(cell), cell.state)
    }
    const prev = prevStates.current
    prevStates.current = next
    if (prev == null) return
    const flipped: string[] = []
    for (const [key, state] of next) {
      if (state === 'complete' && prev.get(key) != null && prev.get(key) !== 'complete') {
        flipped.push(key)
      }
    }
    if (flipped.length === 0) return
    setCelebrating(new Set(flipped))
    const timer = setTimeout(() => setCelebrating(new Set()), 400)
    return () => clearTimeout(timer)
  }, [grid])

  const columnCount = grid.columns.length

  return (
    <section
      aria-label={`${grid.year} work progress by period`}
      data-testid="year-grid"
      className="rounded-xl border border-border bg-card px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={prevYearHref}
            aria-label="Previous year"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <h2 className="tnum font-display text-base font-semibold tracking-tight text-foreground">
            {grid.year}
          </h2>
          <Link
            href={nextYearHref}
            aria-label="Next year"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <YearGridLegend />
      </div>

      {grid.onHold && grid.note && (
        <p
          data-testid="year-grid-note"
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-status-on-hold-bg px-3 py-2 text-xs font-medium text-status-on-hold"
        >
          <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {grid.note}
        </p>
      )}

      <div
        className="mt-3 grid gap-1"
        style={{ gridTemplateColumns: `minmax(8.5rem, 10rem) repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {/* Column headers: the cadence month labels. */}
        <span aria-hidden />
        {grid.columns.map((column) => (
          <span
            key={`${column.year}-${column.month}`}
            className="tnum pb-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {monthLabel(column.year, column.month).split(' ')[0]}
          </span>
        ))}

        {grid.rows.map((row) => {
          const { Icon } = KIND_META[STREAM_KIND[row.stream]]
          return [
            <span
              key={`${row.stream}-label`}
              className="flex items-center gap-1.5 pr-2 text-xs font-medium text-muted-foreground"
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                  KIND_STYLE[STREAM_KIND[row.stream]].chip,
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <span className="truncate">{STREAM_LABEL[row.stream]}</span>
            </span>,
            ...row.cells.map((cell) => {
              const meta = YEAR_GRID_CELL_META[cell.state]
              const clickable = cell.state !== 'no_work'
              const selected =
                filter != null &&
                filter.stream === cell.stream &&
                filter.year === cell.year &&
                filter.month === cell.month
              const celebratingCell = celebrating.has(cellKey(cell))
              return (
                <Tooltip key={cellKey(cell)}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="year-grid-cell"
                      data-state={cell.state}
                      data-stream={cell.stream}
                      data-month={`${cell.year}-${cell.month}`}
                      disabled={!clickable}
                      aria-label={cellAriaLabel(cell)}
                      aria-pressed={clickable ? selected : undefined}
                      onClick={
                        clickable
                          ? () =>
                              onCellClick(
                                selected
                                  ? null
                                  : {
                                      kind: STREAM_KIND[cell.stream],
                                      stream: cell.stream,
                                      year: cell.year,
                                      month: cell.month,
                                      months: cell.months,
                                      label: `${STREAM_LABEL[cell.stream]} · ${monthLabel(cell.year, cell.month)}`,
                                    },
                              )
                          : undefined
                      }
                      className={cn(
                        'flex h-8 items-center justify-center rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        meta.classes,
                        clickable && 'cursor-pointer hover:ring-1 hover:ring-ring/60',
                        !clickable && 'cursor-default',
                        selected && 'ring-2 ring-ring',
                        celebratingCell && 'motion-safe:scale-110 motion-safe:ring-2 motion-safe:ring-status-on-track/60',
                      )}
                    >
                      <StateIcon meta={meta} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{countsSentence(cell)}</TooltipContent>
                </Tooltip>
              )
            }),
          ]
        })}
      </div>
    </section>
  )
}

/** Compact legend for the six cell states - swatch plus text, never color alone. */
export function YearGridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Grid legend">
      {YEAR_GRID_CELL_STATES.map((state) => {
        const meta = YEAR_GRID_CELL_META[state]
        return (
          <span
            key={state}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-sm', meta.classes)}
            >
              {meta.Icon == null ? (
                <span aria-hidden className="h-1 w-1 rounded-full bg-current" />
              ) : (
                <meta.Icon className="h-2.5 w-2.5" aria-hidden />
              )}
            </span>
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}
