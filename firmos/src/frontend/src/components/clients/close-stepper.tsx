'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  PauseCircle,
} from 'lucide-react'
import { parseLocalDate, workPeriodForDue } from '@firmos/domain'

import type { WorkCardKind } from '@/server/queue'
import type {
  ClientYearGrid,
  CloseStep,
  CloseStepKey,
  CloseSteps,
  YearGridCellState,
} from '@/server/year-grid'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { KIND_META, KIND_STYLE } from '@/components/workstation/work-card'

/**
 * The guided close (FIRMOS-VISUAL-ELITE-PLAN Wave 3): the month shown as four
 * ordered segments - Categorize -> Reconcile -> Questions -> Reports - with a
 * progress line that fills as steps complete. Segment identity uses the work
 * -kind colors; segment state uses the 6-token status language (icon + text,
 * never color alone), and every state comes from the same engine the year
 * grid reads, so the stepper can never disagree with the cells below it.
 * When all four steps complete, the panel celebrates: every segment green
 * and a "Books closed" line.
 */

/** Step -> the work-card kind whose identity color and icon it borrows. */
const STEP_KIND: Record<CloseStepKey, WorkCardKind> = {
  categorize: 'bank_feed',
  reconcile: 'reconciliation',
  questions: 'task',
  reports: 'report',
}

/** Short segment captions; the full step label stays in the aria-label. */
const STEP_SHORT_LABEL: Record<CloseStepKey, string> = {
  categorize: 'Categorize',
  reconcile: 'Reconcile',
  questions: 'Questions',
  reports: 'Reports',
}

/**
 * Drawer context match: a recurring-summary task title -> its close step.
 * Recurring instances keep the rule title verbatim (§19).
 */
export function closeStepTitleKey(title: string): CloseStepKey | null {
  const n = title.trim().toLowerCase()
  if (n === 'categorize transactions') return 'categorize'
  if (n === 'reconcile accounts') return 'reconcile'
  if (n === 'client questions') return 'questions'
  if (n === 'send reports') return 'reports'
  return null
}

interface StepStateMeta {
  line: (step: CloseStep) => string
  fg: string
  Icon: typeof Check | null
}

const STEP_STATE: Record<YearGridCellState, StepStateMeta> = {
  complete: { line: () => 'Done', fg: 'text-status-on-track', Icon: Check },
  in_progress: {
    line: (s) => (s.total > 0 ? `${s.completed} of ${s.total} done` : 'In progress'),
    fg: 'text-status-due-soon',
    Icon: Clock,
  },
  behind: {
    line: (s) => (s.overdue > 0 ? `${s.overdue} overdue` : 'Behind'),
    fg: 'text-status-overdue',
    Icon: AlertCircle,
  },
  waiting: { line: () => 'Waiting on client', fg: 'text-status-waiting-client', Icon: PauseCircle },
  not_due: { line: () => 'Not due yet', fg: 'text-muted-foreground', Icon: null },
  no_work: { line: () => 'No work', fg: 'text-muted-foreground', Icon: null },
}

/**
 * The four segments joined by a progress line. The line spans the first to
 * the last segment chip and fills left to right as steps complete (color
 * transition only, 300ms, motion-safe gated). Shared by the Work tab panel
 * and the task drawer's in-context mini stepper.
 */
export function CloseStepSegments({
  steps,
  currentKey = null,
}: {
  steps: CloseStep[]
  /** Drawer context: the step the open task belongs to gets a ring. */
  currentKey?: CloseStepKey | null
}) {
  const doneCount = steps.filter((s) => s.state === 'complete').length
  // Fill the gaps, not the chips: k done steps fill min(k, n-1) of n-1 gaps.
  // The track spans the middle 75% of the row (first to last chip center).
  const gapsFilled = steps.length > 1 ? Math.min(doneCount, steps.length - 1) / (steps.length - 1) : 0
  const fillWidth = Math.round(gapsFilled * 75 * 100) / 100

  return (
    <ol className="relative flex items-start" data-testid="close-steps">
      <span
        aria-hidden
        className="absolute inset-x-[12.5%] top-3.5 h-0.5 rounded-full bg-border"
      />
      <span
        aria-hidden
        data-testid="close-steps-fill"
        className="absolute left-[12.5%] top-3.5 h-0.5 rounded-full bg-status-on-track motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: `${fillWidth}%` }}
      />
      {steps.map((step) => {
        const meta = STEP_STATE[step.state]
        const { Icon: KindIcon } = KIND_META[STEP_KIND[step.key]]
        const done = step.state === 'complete'
        const StateIcon = meta.Icon
        return (
          <li
            key={step.key}
            data-testid="close-step"
            data-step={step.key}
            data-state={step.state}
            aria-label={`${step.label}: ${meta.line(step)}`}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
          >
            <span
              aria-hidden
              className={cn(
                'z-10 flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-300',
                done
                  ? 'border-status-on-track/40 bg-status-on-track-bg text-status-on-track'
                  : cn('border-transparent', KIND_STYLE[STEP_KIND[step.key]].chip),
                currentKey === step.key && 'ring-2 ring-ring/50',
              )}
            >
              {done ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <KindIcon className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="w-full truncate px-0.5 text-[11px] font-medium text-foreground">
              {STEP_SHORT_LABEL[step.key]}
            </span>
            <span className={cn('tnum inline-flex items-center gap-1 text-[10px]', meta.fg)}>
              {StateIcon && <StateIcon className="h-2.5 w-2.5" aria-hidden />}
              {meta.line(step)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The column holding the current work period (domain RULE 2 cutoff). */
function defaultColumnIndex(grid: ClientYearGrid): number {
  const thisYear = Number(grid.today.slice(0, 4))
  if (grid.year < thisYear) return grid.columns.length - 1
  if (grid.year > thisYear) return 0
  const work = workPeriodForDue(parseLocalDate(grid.today))
  const index = grid.columns.findIndex((c) => c.month >= work.month)
  return index === -1 ? grid.columns.length - 1 : index
}

interface CloseStepperProps {
  grid: ClientYearGrid
  prevYearHref: string
  nextYearHref: string
}

export function CloseStepper({ grid, prevYearHref, nextYearHref }: CloseStepperProps) {
  const [selected, setSelected] = useState(() => defaultColumnIndex(grid))
  // Year navigation remounts the grid payload: re-anchor on the new year's
  // current period instead of keeping a stale column index.
  const [selectedYear, setSelectedYear] = useState(grid.year)
  if (selectedYear !== grid.year) {
    setSelectedYear(grid.year)
    setSelected(defaultColumnIndex(grid))
  }

  const current: CloseSteps | undefined = grid.closeSteps[selected]
  if (!current) return null

  const atFirst = selected === 0
  const atLast = selected === grid.closeSteps.length - 1
  const label = monthLabel(current.year, current.month)

  return (
    <section
      aria-label={`Close ${label}`}
      data-testid="close-stepper"
      className={cn(
        'rounded-xl border bg-card px-4 py-3.5 transition-colors duration-300',
        current.allDone ? 'border-status-on-track/40 bg-status-on-track-bg/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {atFirst ? (
            <Link
              href={prevYearHref}
              aria-label="Previous month"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelected((i) => Math.max(i - 1, 0))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <h2 className="tnum font-display text-base font-semibold tracking-tight text-foreground">
            Close {label}
          </h2>
          {atLast ? (
            <Link
              href={nextYearHref}
              aria-label="Next month"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelected((i) => Math.min(i + 1, grid.closeSteps.length - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {current.allDone ? (
          <span
            data-testid="close-stepper-closed"
            className="inline-flex items-center gap-1.5 rounded-full bg-status-on-track-bg px-2.5 py-1 text-xs font-semibold text-status-on-track"
          >
            <CircleCheck className="h-3.5 w-3.5" aria-hidden />
            Books closed for {label}
          </span>
        ) : (
          <span className="tnum text-xs text-muted-foreground" data-testid="close-stepper-count">
            {current.doneCount} of {current.steps.length} steps done
          </span>
        )}
      </div>

      <div className="mt-3">
        <CloseStepSegments steps={current.steps} />
      </div>
    </section>
  )
}
