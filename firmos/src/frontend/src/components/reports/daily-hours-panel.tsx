'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { getDailyHoursAction } from '@/server/actions/time'
import type { DailyHours } from '@/server/time-tracking'
import { dayLabel, weekdayLabel, weekdayOf } from '@/shared/lib/date-display'

import { activityLabel, formatHours, timeLabel } from './format'

/**
 * Per-day chronological hours for one team member (call notes: "Monday she
 * had 6 hours, Tuesday 6, Wednesday 3 - with what was worked on"). Loads
 * lazily when a team-hours row is expanded; each day row expands to the
 * clipped, in-order work entries. All math is the server's interval union.
 */

interface DailyHoursPanelProps {
  userId: number
  fromIso: string
  toIso: string
}

function entryLabel(entry: DailyHours['entries'][number]): string {
  const what = entry.kind === 'activity' ? activityLabel(entry.label) : entry.label
  return entry.clientName ? `${what} - ${entry.clientName}` : what
}

export function DailyHoursPanel({ userId, fromIso, toIso }: DailyHoursPanelProps) {
  const [days, setDays] = React.useState<DailyHours[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [openDays, setOpenDays] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    let cancelled = false
    getDailyHoursAction(userId, fromIso, toIso).then((result) => {
      if (cancelled) return
      if (result.ok) setDays(result.data)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [userId, fromIso, toIso])

  function toggleDay(date: string) {
    setOpenDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  if (error) {
    return <p className="text-xs text-muted-foreground">{error}</p>
  }
  if (days === null) {
    return <p className="text-xs text-muted-foreground">Loading days…</p>
  }
  if (days.length === 0) {
    return <p className="text-xs text-muted-foreground">No day-by-day time in this range.</p>
  }

  return (
    <ul className="space-y-0.5">
      {days.map((day) => {
        const open = openDays.has(day.date)
        return (
          <li key={day.date} data-testid="daily-hours-day" data-date={day.date}>
            <button
              type="button"
              onClick={() => toggleDay(day.date)}
              aria-expanded={open}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? (
                <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="font-medium text-foreground">
                {weekdayLabel(weekdayOf(day.date), 'long')}, {dayLabel(day.date)}
              </span>
              <span className="tnum ml-auto text-muted-foreground">
                {formatHours(day.totalMinutes)} h
              </span>
            </button>
            {open && (
              <ul className="ml-6 space-y-0.5 border-l border-border py-1 pl-2">
                {day.entries.map((entry, i) => (
                  <li
                    key={`${entry.startedAt}-${i}`}
                    data-testid="daily-hours-entry"
                    className="text-xs text-muted-foreground"
                  >
                    <span className="tnum">
                      {timeLabel(entry.startedAt)}-{timeLabel(entry.endedAt)}
                    </span>{' '}
                    {entryLabel(entry)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
