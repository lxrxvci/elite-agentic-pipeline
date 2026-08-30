import Link from 'next/link'
import { AlertCircle, Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Download, FileText } from 'lucide-react'

import { fullDateLabel } from '@/components/clients/format'
import type { PortalReportCell, PortalReportCellState } from '@/server/portal-progress'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

/**
 * Portal reports calendar (Wave 4): the delivered-reports year as twelve
 * month cells in the same cell language the staff grids use - delivered
 * reads on-track with a check, an undelivered month past its due date reads
 * behind, scheduled months stay muted, and months with no report scheduled
 * are dashed absence. Never color alone: every cell pairs its tint with an
 * icon and an accessible label. Delivered months anchor down to their
 * download list below the calendar.
 */

interface CellMeta {
  label: string
  Icon: typeof Check
  classes: string
}

const REPORT_CELL_META: Record<PortalReportCellState, CellMeta> = {
  delivered: {
    label: 'Delivered',
    Icon: Check,
    classes: 'border-transparent bg-status-on-track-bg text-status-on-track',
  },
  past_due: {
    label: 'Past due',
    Icon: AlertCircle,
    classes: 'border-transparent bg-status-overdue-bg text-status-overdue',
  },
  upcoming: {
    label: 'Scheduled',
    Icon: Clock,
    classes: 'border-transparent bg-muted text-muted-foreground',
  },
  no_work: {
    label: 'No report scheduled',
    Icon: CircleDashed,
    classes: 'border-dashed border-border bg-transparent text-muted-foreground',
  },
}

const REPORT_CELL_STATES: PortalReportCellState[] = ['delivered', 'past_due', 'upcoming', 'no_work']

function shortMonth(year: number, month: number): string {
  return monthLabel(year, month).replace(/ \d+$/, '')
}

function cellAriaLabel(cell: PortalReportCell): string {
  const meta = REPORT_CELL_META[cell.state]
  const base = `${monthLabel(cell.year, cell.month)}: ${meta.label}`
  if (cell.state === 'delivered') {
    return `${base}, ${cell.docs.length} ${cell.docs.length === 1 ? 'file' : 'files'}`
  }
  if (cell.dueDate) return `${base}, due ${fullDateLabel(cell.dueDate)}`
  return base
}

function monthAnchor(cell: PortalReportCell): string {
  return `portal-reports-${cell.year}-${cell.month}`
}

interface PortalReportsCalendarProps {
  year: number
  cells: PortalReportCell[]
  prevYearHref: string
  nextYearHref: string
}

export function PortalReportsCalendar({
  year,
  cells,
  prevYearHref,
  nextYearHref,
}: PortalReportsCalendarProps) {
  const delivered = cells.filter((c) => c.state === 'delivered' && c.docs.length > 0)

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label={`${year} reports by month`}
        data-testid="portal-reports-calendar"
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
              {year}
            </h2>
            <Link
              href={nextYearHref}
              aria-label="Next year"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Grid legend">
            {REPORT_CELL_STATES.map((state) => {
              const meta = REPORT_CELL_META[state]
              return (
                <span
                  key={state}
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded-sm border',
                      meta.classes,
                    )}
                  >
                    <meta.Icon className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  {meta.label}
                </span>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {cells.map((cell) => {
            const meta = REPORT_CELL_META[cell.state]
            const className = cn(
              'flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-md border text-[11px] font-medium',
              meta.classes,
            )
            const body = (
              <>
                <meta.Icon aria-hidden className="h-3.5 w-3.5" />
                {shortMonth(cell.year, cell.month)}
              </>
            )
            if (cell.state === 'delivered' && cell.docs.length > 0) {
              return (
                <a
                  key={cell.month}
                  href={`#${monthAnchor(cell)}`}
                  aria-label={`${cellAriaLabel(cell)}. Jump to downloads.`}
                  data-testid="portal-report-cell"
                  data-state={cell.state}
                  data-month={`${cell.year}-${cell.month}`}
                  className={cn(className, 'hover:ring-2 hover:ring-ring')}
                >
                  {body}
                </a>
              )
            }
            return (
              <div
                key={cell.month}
                role="img"
                aria-label={cellAriaLabel(cell)}
                data-testid="portal-report-cell"
                data-state={cell.state}
                data-month={`${cell.year}-${cell.month}`}
                className={className}
              >
                {body}
              </div>
            )
          })}
        </div>
      </section>

      {delivered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {delivered.map((cell) => (
            <section
              key={cell.month}
              id={monthAnchor(cell)}
              aria-label={`${monthLabel(cell.year, cell.month)} downloads`}
              className="scroll-mt-24 rounded-lg border border-border bg-card p-4"
            >
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Check aria-hidden className="h-3.5 w-3.5 text-status-on-track" />
                {monthLabel(cell.year, cell.month)}
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {cell.docs.map((doc) => (
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
