'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight, CircleCheck, PauseCircle } from 'lucide-react'
import { parseLocalDate, workPeriodForDue } from '@firmos/domain'

import { CloseStepSegments } from '@/components/clients/close-stepper'
import {
  STREAM_KIND,
  STREAM_LABEL,
  YEAR_GRID_CELL_META,
  YearGridLegend,
} from '@/components/clients/year-grid'
import { KIND_META, KIND_STYLE } from '@/components/workstation/work-card'
import type { ClientYearGrid, CloseSteps, YearGridCell, YearGridStream } from '@/server/year-grid'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

/**
 * Portal home progress (FIRMOS-VISUAL-ELITE-PLAN Wave 4): the acting
 * client's own year grid rendered read-only with the exact cell language
 * the staff grid uses (same meta, same kind-colored stream chips, same
 * legend), plus the guided close stepper for the current period above it.
 * Cells are informational only - no click-to-anything affordances; the
 * client-facing counts sentence says "waiting on you" where staff read
 * "waiting on client". When the current period's four close steps are all
 * done, the panel takes the stepper's closed treatment and celebrates.
 */

/** "Bank feeds" already plural; the count-noun the sentence needs. */
const STREAM_NOUN: Record<YearGridStream, string> = {
  bank_feeds: 'feeds',
  reconciliations: 'reconciliations',
  reports: 'reports',
  tasks: 'requests',
}

function countsSentence(cell: YearGridCell): string {
  if (cell.state === 'no_work') return 'nothing scheduled for this period'
  if (cell.state === 'not_due' && cell.total === 0) return 'nothing due yet'
  const parts = [`${cell.completed} of ${cell.total} ${STREAM_NOUN[cell.stream]} done`]
  if (cell.waiting > 0) parts.push(`${cell.waiting} waiting on you`)
  if (cell.overdue > 0) parts.push(`${cell.overdue} overdue`)
  return parts.join(', ')
}

function cellAriaLabel(cell: YearGridCell): string {
  const meta = YEAR_GRID_CELL_META[cell.state]
  const state = cell.state === 'waiting' ? 'Waiting on you' : meta.label
  return `${STREAM_LABEL[cell.stream]}, ${monthLabel(cell.year, cell.month)}: ${state}, ${countsSentence(cell)}`
}

/** The column holding the current work period (domain RULE 2 cutoff). */
function currentColumnIndex(grid: ClientYearGrid): number {
  const thisYear = Number(grid.today.slice(0, 4))
  if (grid.year < thisYear) return grid.columns.length - 1
  if (grid.year > thisYear) return 0
  const work = workPeriodForDue(parseLocalDate(grid.today))
  const index = grid.columns.findIndex((c) => c.month >= work.month)
  return index === -1 ? grid.columns.length - 1 : index
}

interface PortalYearProgressProps {
  grid: ClientYearGrid
  /** Streams the acting account may see (tasks row needs can_view_tasks). */
  streams: YearGridStream[]
  prevYearHref: string
  nextYearHref: string
}

export function PortalYearProgress({
  grid,
  streams,
  prevYearHref,
  nextYearHref,
}: PortalYearProgressProps) {
  const current: CloseSteps | undefined = grid.closeSteps[currentColumnIndex(grid)]
  const rows = grid.rows.filter((row) => streams.includes(row.stream))
  const columnCount = grid.columns.length
  const closedLabel = current ? monthLabel(current.year, current.month) : null

  return (
    <section
      aria-labelledby="portal-progress-heading"
      data-testid="portal-year-progress"
      className={cn(
        'rounded-xl border bg-card px-4 py-3.5 transition-colors duration-300',
        current?.allDone ? 'border-status-on-track/40 bg-status-on-track-bg/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="portal-progress-heading" className="text-sm font-semibold">
            Where your books stand
          </h2>
          <div className="flex items-center gap-1">
            <Link
              href={prevYearHref}
              aria-label="Previous year"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <span className="tnum font-display text-base font-semibold tracking-tight text-foreground">
              {grid.year}
            </span>
            <Link
              href={nextYearHref}
              aria-label="Next year"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
        <YearGridLegend />
      </div>

      {grid.onHold && grid.note && (
        <p
          data-testid="portal-year-progress-note"
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-status-on-hold-bg px-3 py-2 text-xs font-medium text-status-on-hold"
        >
          <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {grid.note}
        </p>
      )}

      {current && (
        <div className="mt-3 border-b border-border pb-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Close {monthLabel(current.year, current.month)}
            </p>
            {current.allDone ? (
              <span
                data-testid="portal-books-closed"
                className="inline-flex items-center gap-1.5 rounded-full bg-status-on-track-bg px-2.5 py-1 text-xs font-semibold text-status-on-track"
              >
                <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                Books closed for {closedLabel}
              </span>
            ) : (
              <span className="tnum text-xs text-muted-foreground" data-testid="portal-close-count">
                {current.doneCount} of {current.steps.length} steps done
              </span>
            )}
          </div>
          <CloseStepSegments steps={current.steps} />
        </div>
      )}

      <div
        className="mt-3 grid gap-1"
        style={{ gridTemplateColumns: `minmax(8.5rem, 10rem) repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        <span aria-hidden />
        {grid.columns.map((column) => (
          <span
            key={`${column.year}-${column.month}`}
            className="tnum pb-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {monthLabel(column.year, column.month).split(' ')[0]}
          </span>
        ))}

        {rows.map((row) => {
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
              return (
                <div
                  key={`${cell.stream}:${cell.year}-${cell.month}`}
                  role="img"
                  aria-label={cellAriaLabel(cell)}
                  title={countsSentence(cell)}
                  data-testid="portal-year-grid-cell"
                  data-state={cell.state}
                  data-stream={cell.stream}
                  data-month={`${cell.year}-${cell.month}`}
                  className={cn('flex h-8 items-center justify-center rounded-md', meta.classes)}
                >
                  {meta.Icon == null ? (
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                  ) : (
                    <meta.Icon className="h-3.5 w-3.5" aria-hidden />
                  )}
                </div>
              )
            }),
          ]
        })}
      </div>
    </section>
  )
}
