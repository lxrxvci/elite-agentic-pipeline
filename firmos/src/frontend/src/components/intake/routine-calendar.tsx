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


export function RoutineCalendar({ tasks, entries }: { tasks: RoutineTaskDef[]; entries: RoutineSchedule }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const plot: Map<number, PlottedTask[]> = plotMonthTasks(tasks, entries, year, month)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leadingBlanks = new Date(year, month - 1, 1).getDay()
  const monthName = now.toLocaleString('en-US', { month: 'long' })
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const selectedTasks = selectedDay != null ? (plot.get(selectedDay) ?? []) : []

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      aria-label={`A month of scheduled work - ${monthName}`}
      data-testid="routine-calendar"
    >
      <h2 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>What a month of this looks like</span>
        <span className="font-normal normal-case tracking-normal">{monthName}</span>
      </h2>
      <p className="sr-only" data-testid="routine-calendar-summary">
        {plot.size === 0
          ? 'Nothing scheduled this month yet.'
          : `${plot.size} day${plot.size === 1 ? '' : 's'} with scheduled work this month. Pick a highlighted day to see its tasks.`}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i} aria-hidden="true" className="pb-1 text-center text-[10px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
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
