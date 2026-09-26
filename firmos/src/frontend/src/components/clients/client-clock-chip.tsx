'use client'

import * as React from 'react'
import { Clock, Square } from 'lucide-react'

import { refreshClockStatus, toastTimerSwitch, useClockStatus } from '@/shared/lib/clock-status'
import { isBreakActivityType } from '@firmos/domain'
import { cn } from '@/shared/lib/utils'

/**
 * Clock-C1 client-page clock chip (TaxDome job-card pattern): the client
 * record header carries the same start/stop as the top-bar widget. Idle =
 * "Clock in to this client" (green action); running = "On the clock · 42m"
 * (click stops). Starting here auto-stops whatever timer was running
 * (single-work-timer invariant) and toasts the switch. State rides the
 * shared clock-status store, so the chip and the widget never disagree.
 */
export function ClientClockChip({ clientId }: { clientId: number }) {
  const clock = useClockStatus()
  const [busy, setBusy] = React.useState(false)
  const [, setTick] = React.useState(0)

  const activity = clock?.currentActivity ?? null
  const onTheClock =
    activity != null && activity.clientId === clientId && !isBreakActivityType(activity.activityType)
  const startedAt = onTheClock ? activity.startedAt : null

  React.useEffect(() => {
    if (!onTheClock) return
    const t = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [onTheClock])

  const elapsedMinutes = startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000))
    : 0

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const m = await import('@/server/actions/time')
      if (onTheClock && activity) {
        await m.stopActivityAction(
          activity.activityType as Parameters<typeof m.stopActivityAction>[0],
          clientId,
        )
      } else {
        // The day umbrella opens implicitly inside the action; the kind
        // defaults to tasks (client-first: the client is what matters).
        const result = await m.startActivityAction('tasks', clientId)
        if (result.ok) toastTimerSwitch(result.data.switch)
      }
      await refreshClockStatus()
    } catch {
      // no server reach in tests; leave state as-is
    } finally {
      setBusy(false)
    }
  }

  if (onTheClock) {
    return (
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-label={`On the clock for this client, ${elapsedMinutes} minutes - stop the timer`}
        aria-pressed="true"
        data-testid="client-clock-chip"
        data-state="running"
        className="tnum inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-status-on-track bg-status-on-track-bg px-2.5 text-xs font-semibold text-status-on-track transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        On the clock · {elapsedMinutes}m
        <Square className="h-3 w-3" aria-hidden />
        <span className="sr-only">Stop</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-label="Clock in to this client"
      aria-pressed="false"
      data-testid="client-clock-chip"
      data-state="idle"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-firm-action px-2.5 text-xs font-semibold text-firm-action-foreground shadow-sm transition-colors duration-150 hover:bg-firm-action-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Clock in to this client
    </button>
  )
}
