'use client'

import { useState } from 'react'

import {
  ROUTINE_BUCKET_LABELS,
  type RoutineBucket,
  type RoutineSchedule,
  type RoutineTaskDef,
} from '@/shared/lib/routine-schedule'
import { cn } from '@/shared/lib/utils'

/**
 * K5 (E1, 09_30 00:50:15): the scheduling calendar - "each one of these
 * could have a color... the calendar could show what that would look like in
 * terms of the calendar month." A representative month grid, tasks plotted
 * by their schedule, color-coded by cadence bucket: the workload-vs-price
 * sanity check ("lit up like a Christmas tree") and the sales visual.
 * K8 (E1 drill): clicking a plotted day lists the tasks landing on it.
 * Edits stay on the bucket board above - the calendar never edits.
 */

/** Jason's palette (00:50:15): daily green, weekly yellow, monthly orange. */
export const BUCKET_DOT: Record<RoutineBucket, string> = {
  daily: 'bg-emerald-400',
  weekly: 'bg-amber-300',
  monthly: 'bg-orange-300',
  quarterly: 'bg-violet-300',
  annual: 'bg-sky-300',
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

interface PlottedDay {
  day: number
  buckets: RoutineBucket[]
}

/** A task landing on a calendar day, for the click-through drill (K8/E1). */
export interface PlottedTask {
  key: string
  title: string
  bucket: RoutineBucket
}

/** The days of `year-month` each entry lands on (1-indexed month). */
export function plotMonth(tasks: RoutineTaskDef[], entries: RoutineSchedule, year: number, month: number): Map<number, RoutineBucket[]> {
  const detailed = plotMonthTasks(tasks, entries, year, month)
  const plot = new Map<number, RoutineBucket[]>()
  for (const [day, plotted] of detailed) plot.set(day, plotted.map((p) => p.bucket))
  return plot
}

// ── L6 (I1/I2, 10_06 00:53:44 + 00:47:52): the star metric ────────────────
//
// A STAR is one scheduled task occurrence on a day ("four star, four star,
// four star… week three has a s*** ton of stars"). The calendar totals them
// per week (row end) and per month (header), and the busiest-month toggle
// answers "maybe we have it show the busiest month." The estimate rail
// carries the average ("every time I've done 450 on 10 stars I've been
// burnt" - the price↔workload gut check).

/** Total stars (task occurrences) one month plots. */
export function monthStarCount(
  tasks: RoutineTaskDef[],
  entries: RoutineSchedule,
  year: number,
  month: number,
): number {
  let total = 0
  for (const plotted of plotMonthTasks(tasks, entries, year, month).values()) total += plotted.length
  return total
}

/** Per-week star totals aligned to the calendar grid (leading blanks count
 *  into week 1, matching the rendered rows). */
export function weekStarCounts(
  tasks: RoutineTaskDef[],
  entries: RoutineSchedule,
  year: number,
  month: number,
): number[] {
  const plot = plotMonthTasks(tasks, entries, year, month)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leadingBlanks = new Date(year, month - 1, 1).getDay()
  const weeks: number[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const weekIndex = Math.floor((leadingBlanks + d - 1) / 7)
    weeks[weekIndex] = (weeks[weekIndex] ?? 0) + (plot.get(d)?.length ?? 0)
  }
  return weeks
}

/** The average month's stars across a full year - the estimate's
 *  "≈ N stars/mo" workload figure beside the price (I1). */
export function averageMonthlyStars(
  tasks: RoutineTaskDef[],
  entries: RoutineSchedule,
  year: number,
): number {
  let total = 0
  for (let m = 1; m <= 12; m++) total += monthStarCount(tasks, entries, year, m)
  return Math.round(total / 12)
}

/** I2: the year's busiest month by star count (null when nothing plots). */
export function busiestMonth(
  tasks: RoutineTaskDef[],
  entries: RoutineSchedule,
  year: number,
): { month: number; stars: number } | null {
  let best: { month: number; stars: number } | null = null
  for (let m = 1; m <= 12; m++) {
    const stars = monthStarCount(tasks, entries, year, m)
    if (stars > 0 && (best == null || stars > best.stars)) best = { month: m, stars }
  }
  return best
}

/** A quarterly/annual task's host-month note for the rotation strip. */
function hostMonthNote(task: RoutineTaskDef, entry: RoutineSchedule[string]): string {
  const src = entry.keepSourceSchedule ? task.sourceSchedule : null
  const scheduleType = src?.scheduleType ?? entry.bucket
  const day = entry.daysAfterPeriodEnd ?? src?.dayOfMonth ?? entry.dayOfMonth ?? 10
  if (scheduleType === 'quarterly') return `lands the ${ordinal(day)} of Jan, Apr, Jul, Oct`
  if (scheduleType === 'semi_annual') {
    const anchor = src?.anchorMonth ?? null
    if (anchor == null) return 'twice a year'
    const second = ((anchor + 5) % 12) + 1
    return `lands ${MONTH_SHORT[anchor - 1]} and ${MONTH_SHORT[second - 1]}`
  }
  // annual: fiscal year-end lands the month after; calendar lands January.
  const fiscal = entry.fiscalYearEnd ?? null
  const host = fiscal ? (Number(fiscal.slice(0, 2)) % 12) + 1 : 1
  return `lands each ${MONTH_LONG[host - 1]}`
}

export interface RotationNote {
  key: string
  title: string
  bucket: RoutineBucket
  hostNote: string
}

/** I2: quarterly/semi-annual/annual tasks - "it's not really reflecting
 *  quarterly and annually very well." They only plot on host months, so the
 *  rotation strip keeps them visible every month. */
export function rotationNotes(tasks: RoutineTaskDef[], entries: RoutineSchedule): RotationNote[] {
  const out: RotationNote[] = []
  for (const task of tasks) {
    const entry = entries[task.key]
    if (!entry) continue
    const src = entry.keepSourceSchedule ? task.sourceSchedule : null
    const scheduleType = src?.scheduleType ?? entry.bucket
    if (scheduleType !== 'quarterly' && scheduleType !== 'semi_annual' && scheduleType !== 'annual') continue
    out.push({
      key: task.key,
      title: task.title,
      bucket: entry.bucket,
      hostNote: hostMonthNote(task, entry),
    })
  }
  return out
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** K8 (E1 drill): which tasks land on each day of `year-month` (1-indexed). */
export function plotMonthTasks(tasks: RoutineTaskDef[], entries: RoutineSchedule, year: number, month: number): Map<number, PlottedTask[]> {
  const daysInMonth = new Date(year, month, 0).getDate()
  const plot = new Map<number, PlottedTask[]>()
  const mark = (day: number, task: RoutineTaskDef, bucket: RoutineBucket) => {
    if (day < 1 || day > daysInMonth) return
    plot.set(day, [...(plot.get(day) ?? []), { key: task.key, title: task.title, bucket }])
  }
  const firstWeekdayOccurrence = (weekday: number): number => {
    const first = new Date(year, month - 1, 1).getDay()
    return ((weekday - first + 7) % 7) + 1
  }

  for (const task of tasks) {
    const entry = entries[task.key]
    if (!entry) continue
    const bucket = entry.bucket
    // keepSourceSchedule rows carry their engine schedule; visualize the
    // closest bucket equivalent.
    const src = entry.keepSourceSchedule ? task.sourceSchedule : null
    const scheduleType = src?.scheduleType ?? bucket
    switch (scheduleType) {
      case 'daily': {
        // sourceSchedule.daysOfWeek is a CSV string ("1,3,5") when present.
        const srcDays = src?.daysOfWeek
          ?.split(',')
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        const weekdays: number[] = entry.weekdays ?? (srcDays && srcDays.length > 0 ? srcDays : [1, 2, 3, 4, 5])
        for (let d = 1; d <= daysInMonth; d++) {
          if (weekdays.includes(new Date(year, month - 1, d).getDay())) mark(d, task, bucket)
        }
        break
      }
      case 'weekly': {
        const srcDays = src?.daysOfWeek
          ?.split(',')
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        const weekdays: number[] = entry.weekdays ?? (srcDays && srcDays.length > 0 ? srcDays : [5])
        const everyN = entry.everyNWeeks ?? 1
        for (const weekday of weekdays) {
          const first = firstWeekdayOccurrence(weekday)
          for (let d = first; d <= daysInMonth; d += 7 * everyN) mark(d, task, bucket)
        }
        break
      }
      case 'monthly':
        mark(entry.dayOfMonth ?? src?.dayOfMonth ?? 10, task, bucket)
        break
      case 'quarterly': {
        // Quarter-end months are 3/6/9/12; the task lands the FOLLOWING
        // month, daysAfterPeriodEnd days in. This month hosts one when
        // (month - 1) % 3 === 0 (Jan/Apr/Jul/Oct).
        if ((month - 1) % 3 === 0) mark(Number(entry.daysAfterPeriodEnd ?? src?.dayOfMonth ?? 10), task, bucket)
        break
      }
      case 'semi_annual': {
        const anchor = src?.anchorMonth ?? null
        if (anchor != null && (month === anchor || month === ((anchor + 5) % 12) + 1)) {
          mark(src?.dayOfMonth ?? entry.dayOfMonth ?? 15, task, bucket)
        }
        break
      }
      case 'annual': {
        // Calendar year-end: Dec 31 -> lands in January. Fiscal year-end
        // (MM-DD): lands in the month AFTER that fiscal month.
        const fiscal = entry.fiscalYearEnd ?? null
        const hostMonth = fiscal ? (Number(fiscal.slice(0, 2)) % 12) + 1 : 1
        if (month === hostMonth) mark(Number(entry.daysAfterPeriodEnd ?? src?.dayOfMonth ?? 31), task, bucket)
        break
      }
      default:
        mark(entry.dayOfMonth ?? 10, task, bucket)
    }
  }
  return plot
}


export function RoutineCalendar({
  tasks,
  entries,
  anchorMonth,
}: {
  tasks: RoutineTaskDef[]
  entries: RoutineSchedule
  /** Test/determinism hook: the "current" month (defaults to today). */
  anchorMonth?: { year: number; month: number }
}) {
  const now = new Date()
  const year = anchorMonth?.year ?? now.getFullYear()
  const currentMonth = anchorMonth?.month ?? now.getMonth() + 1
  // L6 (I2, 10_06 00:47:52): "maybe we have it show the busiest month" -
  // the toggle swaps the view between the current and peak months.
  const busiest = busiestMonth(tasks, entries, year)
  const [viewMode, setViewMode] = useState<'current' | 'busiest'>('current')
  const month = viewMode === 'busiest' && busiest ? busiest.month : currentMonth
  const plot: Map<number, PlottedTask[]> = plotMonthTasks(tasks, entries, year, month)
  const weekStars = weekStarCounts(tasks, entries, year, month)
  const monthStars = weekStars.reduce((a, n) => a + n, 0)
  const rotation = rotationNotes(tasks, entries)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leadingBlanks = new Date(year, month - 1, 1).getDay()
  const monthName = MONTH_LONG[month - 1]
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // L6 (I1): the grid renders as week rows so each row carries its star
  // total at the end ("week three has a s*** ton of stars").
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const selectedTasks = selectedDay != null ? (plot.get(selectedDay) ?? []) : []

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      aria-label={`A month of scheduled work - ${monthName}`}
      data-testid="routine-calendar"
    >
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>
          What a month of this looks like
          {/* L6 (I3): the schedule stays PROPOSED until the estimate is
              accepted - days finalize at conversion. */}
          <span
            className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground"
            data-testid="schedule-proposed-badge"
            title="Days are proposed for now - they finalize once the client accepts the estimate."
          >
            Proposed
          </span>
        </span>
        <span className="font-normal normal-case tracking-normal">
          {monthName}
          {/* L6 (I1): the month's star total in the header. */}
          <span className="tnum ml-2 font-semibold text-foreground" data-testid="cal-month-stars">
            {monthStars} ★
          </span>
        </span>
      </h2>
      {busiest && busiest.month !== currentMonth && (
        <div className="mt-2 flex items-center gap-1 text-[11px]" data-testid="busiest-toggle">
          <span className="text-muted-foreground">Show:</span>
          {(
            [
              { key: 'current', label: `Current month (${MONTH_SHORT[currentMonth - 1]})` },
              { key: 'busiest', label: `Busiest month (${MONTH_SHORT[busiest.month]})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={viewMode === t.key}
              data-testid={`busiest-toggle-${t.key}`}
              onClick={() => {
                setViewMode(t.key)
                setSelectedDay(null)
              }}
              className={cn(
                'rounded-full px-2.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                viewMode === t.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <p className="sr-only" data-testid="routine-calendar-summary">
        {plot.size === 0
          ? 'Nothing scheduled this month yet.'
          : `${plot.size} day${plot.size === 1 ? '' : 's'} with scheduled work this month, ${monthStars} stars in total. Pick a highlighted day to see its tasks.`}
      </p>
      <div className="mt-3">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((d, i) => (
            <div key={i} aria-hidden="true" className="pb-1 text-center text-[10px] font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {weeks.map((week, w) => (
            <div key={w} className="flex items-start gap-1" data-testid={`cal-week-${w + 1}`}>
              <div className="grid flex-1 grid-cols-7 gap-1">
                {week.map((day, i) => {
                  if (day == null) return <div key={i} aria-hidden="true" />
                  const plotted = plot.get(day) ?? []
                  if (plotted.length === 0) {
                    return (
                      <div
                        key={i}
                        data-testid={`cal-day-${day}`}
                        className="flex h-9 flex-col items-center justify-start rounded-md pt-1 text-[11px] text-muted-foreground"
                      >
                        <span className="tnum leading-none">{day}</span>
                      </div>
                    )
                  }
                  // K8 (E1 drill): a plotted day is a button - click lists its tasks.
                  const active = selectedDay === day
                  return (
                    <button
                      key={i}
                      type="button"
                      data-testid={`cal-day-${day}`}
                      aria-pressed={active}
                      aria-label={`${monthName} ${day}: ${plotted.length} scheduled task${plotted.length === 1 ? '' : 's'}`}
                      onClick={() => setSelectedDay(active ? null : day)}
                      className={cn(
                        'flex h-9 flex-col items-center justify-start rounded-md pt-1 text-[11px] transition-colors duration-150',
                        'bg-accent/60 font-medium text-foreground hover:bg-accent',
                        active && 'ring-2 ring-firm-brand/60',
                      )}
                    >
                      <span className="tnum leading-none">{day}</span>
                      <span className="mt-1 flex gap-0.5" aria-hidden="true">
                        {plotted.slice(0, 3).map((p, j) => (
                          <span key={j} className={cn('h-1.5 w-1.5 rounded-full', BUCKET_DOT[p.bucket])} />
                        ))}
                        {plotted.length > 3 && (
                          <span className="text-[8px] leading-none text-muted-foreground">+{plotted.length - 3}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* L6 (I1): the week's star total at the row end. */}
              <span
                className="tnum w-10 shrink-0 pt-1 text-right text-[10px] font-semibold text-muted-foreground"
                data-testid={`cal-week-stars-${w + 1}`}
                aria-label={`Week ${w + 1}: ${weekStars[w] ?? 0} stars`}
              >
                {weekStars[w] ?? 0} ★
              </span>
            </div>
          ))}
        </div>
      </div>
      {selectedDay != null && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3" data-testid="cal-day-detail">
          <h3 className="text-xs font-semibold text-foreground">
            {monthName} {selectedDay} - {selectedTasks.length} task{selectedTasks.length === 1 ? '' : 's'}
          </h3>
          <ul className="mt-2 space-y-1">
            {selectedTasks.map((t, j) => (
              <li
                key={`${t.key}-${j}`}
                className="flex items-center gap-2 text-[12px] text-foreground"
                data-testid="cal-day-task"
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', BUCKET_DOT[t.bucket])} aria-hidden="true" />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ROUTINE_BUCKET_LABELS[t.bucket]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* L6 (I2): quarterly/annual work only plots on host months - the
          rotation strip keeps it visible every month. */}
      {rotation.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2" data-testid="rotation-strip">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Also in the rotation
          </p>
          <ul className="mt-1 space-y-0.5">
            {rotation.map((r) => (
              <li key={r.key} className="flex items-baseline gap-2 text-[11px]" data-testid={`rotation-${r.key}`}>
                <span className={cn('h-2 w-2 shrink-0 self-center rounded-full', BUCKET_DOT[r.bucket])} aria-hidden="true" />
                <span className="text-foreground">{r.title}</span>
                <span className="text-muted-foreground">
                  {ROUTINE_BUCKET_LABELS[r.bucket]} · {r.hostNote}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Cadence colors">
        {(Object.keys(BUCKET_DOT) as RoutineBucket[]).map((b) => (
          <li key={b} className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid={`cal-legend-${b}`}>
            <span className={cn('h-2 w-2 rounded-full', BUCKET_DOT[b])} aria-hidden="true" />
            {ROUTINE_BUCKET_LABELS[b]}
          </li>
        ))}
      </ul>
    </section>
  )
}
