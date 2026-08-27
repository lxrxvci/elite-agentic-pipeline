'use client'

import * as React from 'react'
import { Check, ChevronDown, Clock, LogOut, TimerReset } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  clockInAction,
  clockOutAction,
  getClockStatusAction,
  heartbeatAction,
  startActivityAction,
} from '@/server/actions/time'
import type { ClockStatus, NonDayActivityType } from '@/server/time-tracking'
import { ACTIVITY_META, ACTIVITY_TYPES, formatClock } from '@/components/reports/format'
import { cn } from '@/shared/lib/utils'

/**
 * Top-bar time clock (HANDOFF §6.6, §17). One widget, four truthful states:
 *
 *   loading  - first poll has not returned; renders the neutral stub.
 *   out      - "Not clocked in" + one-click Clock in.
 *   in       - green state dot, ticking day elapsed (tnum), current-activity
 *              chip with the 7-activity switcher, and Clock out (inline
 *              confirm when task timers are open - clock-out closes them).
 *   autoOut  - a poll found the session closed without a local clock-out
 *              (the stale-cleanup auto_clock_out path); one-click re-clock.
 *
 * Truthfulness contract: every mutation re-reads getClockStatus from the
 * action result; the tick between polls is display-only and re-anchors to
 * dayStartedAt on every server read. Poll 30s, heartbeat 60s while clocked
 * in, display tick 1s.
 */

const POLL_MS = 30_000
const HEARTBEAT_MS = 60_000
const TICK_MS = 1_000

type WidgetState = 'loading' | 'out' | 'in' | 'autoOut'

export function ClockWidget({ pollMs = POLL_MS }: { pollMs?: number }) {
  const [status, setStatus] = React.useState<ClockStatus | null>(null)
  const [autoOut, setAutoOut] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmOut, setConfirmOut] = React.useState(false)
  const [, setTick] = React.useState(0)

  // True only for a clock-out the user initiated from this widget - any
  // other in -> out transition means the server closed the session (stale).
  const localClockOutRef = React.useRef(false)
  const clockedInRef = React.useRef(false)

  const applyStatus = React.useCallback((next: ClockStatus) => {
    if (clockedInRef.current && !next.clockedIn && !localClockOutRef.current) {
      setAutoOut(true)
    }
    if (next.clockedIn) setAutoOut(false)
    clockedInRef.current = next.clockedIn
    localClockOutRef.current = false
    setStatus(next)
  }, [])

  const refresh = React.useCallback(async () => {
    const result = await getClockStatusAction()
    if (result.ok) applyStatus(result.data)
  }, [applyStatus])

  React.useEffect(() => {
    void refresh()
    const poll = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(poll)
  }, [refresh, pollMs])

  const clockedIn = status?.clockedIn === true && !autoOut

  React.useEffect(() => {
    if (!clockedIn) return
    const beat = setInterval(() => void heartbeatAction(), HEARTBEAT_MS)
    const tick = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => {
      clearInterval(beat)
      clearInterval(tick)
    }
  }, [clockedIn])

  async function run(action: () => Promise<{ ok: true; data: ClockStatus } | { ok: false; error: string }>) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result.ok) {
        applyStatus(result.data)
        setConfirmOut(false)
      } else {
        setError(result.error)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const state: WidgetState = status == null ? 'loading' : autoOut ? 'autoOut' : status.clockedIn ? 'in' : 'out'

  if (state === 'loading') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="h-8 gap-1.5 text-muted-foreground"
        aria-label="Time clock - loading"
      >
        <Clock aria-hidden className="h-3.5 w-3.5" />
        <span className="text-xs">Not clocked in</span>
      </Button>
    )
  }

  if (state === 'out') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void run(clockInAction)}
        className="h-8 gap-1.5 text-muted-foreground"
        aria-label="Time clock - not clocked in"
        data-testid="clock-widget"
        data-state="out"
      >
        <Clock aria-hidden className="h-3.5 w-3.5" />
        <span className="text-xs">Not clocked in</span>
        <span className="text-xs font-medium text-foreground">Clock in</span>
      </Button>
    )
  }

  if (state === 'autoOut') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void run(clockInAction)}
        className="h-8 gap-1.5 border-status-due-soon/50 text-status-due-soon"
        aria-label="Time clock - clocked out automatically, clock back in"
        data-testid="clock-widget"
        data-state="auto-out"
      >
        <TimerReset aria-hidden className="h-3.5 w-3.5" />
        <span className="text-xs">Clocked out automatically</span>
        <span className="text-xs font-medium text-foreground">Clock back in</span>
      </Button>
    )
  }

  // state === 'in'
  const daySeconds =
    status?.dayStartedAt != null
      ? (Date.now() - new Date(status.dayStartedAt).getTime()) / 1000
      : (status?.dayElapsedMinutes ?? 0) * 60
  const activity = status?.currentActivity ?? null
  const activityMeta = activity ? ACTIVITY_META[activity.activityType as keyof typeof ACTIVITY_META] : null
  const openTimers = status?.openTaskTimers ?? []

  return (
    <div
      className="flex h-8 items-center overflow-hidden rounded-md border border-border"
      data-testid="clock-widget"
      data-state="in"
    >
      <span
        className="flex h-full items-center gap-1.5 border-r border-border bg-status-on-track-bg/40 px-2.5"
        aria-label={`Clocked in for ${formatClock(daySeconds)}`}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-on-track" />
        <span className="tnum text-xs font-medium text-foreground" data-testid="clock-elapsed">
          {formatClock(daySeconds)}
        </span>
      </span>

      <DropdownMenu onOpenChange={(open) => !open && setConfirmOut(false)}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-full items-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={activityMeta ? `Current activity: ${activityMeta.label}` : 'Start an activity'}
          >
            {activityMeta ? (
              <>
                <activityMeta.Icon aria-hidden className="h-3.5 w-3.5" />
                <span>{activityMeta.label}</span>
              </>
            ) : (
              <span>No activity</span>
            )}
            <ChevronDown aria-hidden className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Activity timer</DropdownMenuLabel>
          {ACTIVITY_TYPES.map((type) => {
            const meta = ACTIVITY_META[type]
            const current = activity?.activityType === type
            return (
              <DropdownMenuItem
                key={type}
                disabled={busy || current}
                onSelect={() => void run(() => startActivityAction(type as NonDayActivityType))}
                className="gap-2"
              >
                <meta.Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1">{meta.label}</span>
                {current && <Check aria-hidden className="h-3.5 w-3.5 text-status-on-track" />}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          {openTimers.length > 0 && (
            <>
              <div className="px-2 py-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {openTimers.length} task timer{openTimers.length === 1 ? '' : 's'} running
                </p>
                {openTimers.map((t) => (
                  <p key={t.entryId} className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    <span className="tnum">{formatClock(t.elapsedMinutes * 60)}</span> · {t.taskTitle}
                  </p>
                ))}
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {error && (
            <>
              <p role="alert" className="px-2 py-1.5 text-[11px] text-status-overdue">
                {error}
              </p>
              <DropdownMenuSeparator />
            </>
          )}
          {openTimers.length > 0 && !confirmOut ? (
            <DropdownMenuItem
              className="gap-2 text-status-overdue focus:text-status-overdue"
              onSelect={(e) => {
                e.preventDefault()
                setConfirmOut(true)
              }}
            >
              <LogOut aria-hidden className="h-3.5 w-3.5" />
              Clock out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={busy}
              className={cn('gap-2', openTimers.length > 0 && 'text-status-overdue focus:text-status-overdue')}
              onSelect={(e) => {
                if (openTimers.length > 0) e.preventDefault()
                localClockOutRef.current = true
                void run(clockOutAction)
              }}
            >
              <LogOut aria-hidden className="h-3.5 w-3.5" />
              {confirmOut
                ? `Confirm - stops ${openTimers.length} task timer${openTimers.length === 1 ? '' : 's'}`
                : 'Clock out'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
