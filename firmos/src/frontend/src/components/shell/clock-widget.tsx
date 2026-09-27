'use client'

import * as React from 'react'
import { Check, ChevronDown, Clock, LogOut, Search, SquareCheck, TimerReset } from 'lucide-react'

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
  getIdleGapAction,
  heartbeatAction,
  idleAutoClockOutAction,
  listClockClientsAction,
  resolveIdleTimeAction,
  startActivityAction,
  type TimerStartData,
} from '@/server/actions/time'
import type {
  ClockClientOption,
  ClockStatus,
  IdleForgivenessChoice,
  IdleGap,
  NonDayActivityType,
} from '@/server/time-tracking'
import { ACTIVITY_META, ACTIVITY_TYPES, formatClock } from '@/components/reports/format'
import { toastTimerSwitch } from '@/shared/lib/clock-status'
import { isBreakActivityType } from '@firmos/domain'
import { cn } from '@/shared/lib/utils'

import {
  IdleCountdownModal,
  IdleExplainerDialog,
  IdleForgivenessDialog,
} from './idle-clock-dialogs'
import { useIdleClock } from './use-idle-clock'

/**
 * Top-bar time clock (HANDOFF §6.6, §17), Clock-C1 client-first: the widget
 * is a CLIENT clock, not an activity-kind clock. Four truthful states:
 *
 *   loading  - first poll has not returned; renders the neutral stub.
 *   out      - "Not clocked in" + one-click Clock in.
 *   in       - green state dot + ticking day total, then the client chip:
 *              current client name + ticking timer elapsed + activity kind.
 *              The chip opens the switcher: recency-ordered clients (today's
 *              work-day clients first, then recent), fuzzy search, one-tap
 *              resume; activity kinds start on the current/last client;
 *              breaks stay client-agnostic. "s" quick-switches to the next
 *              recent client (never while typing or inside a menu/dialog).
 *   autoOut  - a poll found the session closed without a local clock-out
 *              (the stale-cleanup auto_clock_out path); one-click re-clock.
 *
 * Every work start carries a client (server-enforced); a start that
 * auto-stops the previous timer toasts "Stopped X and switched". Poll 30s,
 * heartbeat 60s while clocked in (paused while idle - the countdown owns the
 * clock), display tick 1s.
 *
 * Clock-C2 idle system (see use-idle-clock + idle-clock-dialogs): idle past
 * the user's threshold opens a 2-minute countdown modal; expiry closes the
 * session via the idle auto-close path. Returning from any past-threshold
 * idle stretch - or loading the app after the server closed the session
 * while away - opens Toggl's four-choice forgiveness dialog with the gap
 * pre-computed. Focus/visibility-return fire immediate heartbeats (the
 * original's fix for "tab switch clocks me out").
 */

const POLL_MS = 30_000
const HEARTBEAT_MS = 60_000
const TICK_MS = 1_000
/** The countdown modal's run length once the user is idle past threshold. */
const COUNTDOWN_SECONDS = 120

type WidgetState = 'loading' | 'out' | 'in' | 'autoOut'

const WORK_ACTIVITY_TYPES = ACTIVITY_TYPES.filter((t) => !isBreakActivityType(t))
const BREAK_ACTIVITY_TYPES = ACTIVITY_TYPES.filter((t) => isBreakActivityType(t))

/** Light fuzzy match: every query character in order, case-insensitive. */
function fuzzyMatch(name: string, query: string): boolean {
  const n = name.toLowerCase()
  const q = query.toLowerCase()
  if (n.includes(q)) return true
  let i = 0
  for (const ch of n) {
    if (ch === q[i]) i += 1
    if (i === q.length) return true
  }
  return q.length === 0
}

export function ClockWidget({
  pollMs = POLL_MS,
  idleThresholdMs,
  countdownSeconds = COUNTDOWN_SECONDS,
}: {
  pollMs?: number
  /** Test override for the user's idle threshold (status carries the real one). */
  idleThresholdMs?: number
  /** Test override for the countdown modal's run length. */
  countdownSeconds?: number
}) {
  const [status, setStatus] = React.useState<ClockStatus | null>(null)
  const [autoOut, setAutoOut] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmOut, setConfirmOut] = React.useState(false)
  const [clients, setClients] = React.useState<ClockClientOption[] | null>(null)
  const [clientQuery, setClientQuery] = React.useState('')
  const [, setTick] = React.useState(0)
  // Clock-C2 idle state: the countdown's remaining seconds while it shows,
  // and the pending return-time forgiveness gap.
  const [countdown, setCountdown] = React.useState<number | null>(null)
  const [gap, setGap] = React.useState<IdleGap | null>(null)
  const [gapBusy, setGapBusy] = React.useState(false)

  // True only for a clock-out the user initiated from this widget - any
  // other in -> out transition means the server closed the session (stale).
  const localClockOutRef = React.useRef(false)
  const clockedInRef = React.useRef(false)
  // The kind a bare client switch resumes: the running work kind, else the
  // last work kind seen this session, else "tasks".
  const lastWorkKindRef = React.useRef<NonDayActivityType>('tasks')
  // Clock-C2: the idle stretch's baseline (the server's last_activity_at the
  // widget saw when idle began - the return heartbeat stamps it before the
  // server could read the old value, so the baseline must be client-kept).
  const idleBasisRef = React.useRef<string | null>(null)
  const wasIdleRef = React.useRef(false)
  // The closed-while-away gap fetch runs once per clocked-out stretch.
  const closedGapCheckedRef = React.useRef(false)
  // A dialog dismissed (Esc/X) without choosing never re-opens on a poll.
  const dismissedGapRef = React.useRef<number | null>(null)

  const applyStatus = React.useCallback((next: ClockStatus) => {
    if (clockedInRef.current && !next.clockedIn && !localClockOutRef.current) {
      setAutoOut(true)
    }
    if (next.clockedIn) setAutoOut(false)
    clockedInRef.current = next.clockedIn
    localClockOutRef.current = false
    const kind = next.currentActivity?.activityType
    if (kind != null && !isBreakActivityType(kind)) {
      lastWorkKindRef.current = kind as NonDayActivityType
    }
    setStatus(next)
  }, [])

  const refresh = React.useCallback(async () => {
    const result = await getClockStatusAction()
    if (result.ok) applyStatus(result.data)
  }, [applyStatus])

  const loadClients = React.useCallback(async () => {
    const result = await listClockClientsAction()
    if (result.ok) setClients(result.data)
  }, [])

  React.useEffect(() => {
    void refresh()
    void loadClients()
    const poll = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(poll)
  }, [refresh, loadClients, pollMs])

  const clockedIn = status?.clockedIn === true && !autoOut

  // Clock-C2 idle detection: IdleDetector (with the one-time explainer)
  // where available, in-tab fallback elsewhere. Runs only while clocked in.
  const idle = useIdleClock({
    enabled: clockedIn,
    thresholdMs: idleThresholdMs ?? (status?.idleTimeoutMinutes ?? 15) * 60_000,
  })

  // Clock-C2: the countdown modal shows while the user sits idle past the
  // threshold; the tick owns it and the expiry effect closes the clock.
  React.useEffect(() => {
    if (!idle.idle || !clockedIn) {
      setCountdown(null)
      return
    }
    const startedAt = Date.now()
    setCountdown(countdownSeconds)
    const timer = setInterval(() => {
      const remaining = countdownSeconds - Math.floor((Date.now() - startedAt) / 1000)
      setCountdown(remaining)
      if (remaining <= 0) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [idle.idle, clockedIn, countdownSeconds])

  // Clock-C2: capture the idle baseline once per stretch, and on any return
  // from a past-threshold stretch fetch the forgiveness gap (BEFORE any
  // heartbeat could overwrite the server's baseline - the observed baseline
  // rides the call) and then heartbeat to hold the session.
  React.useEffect(() => {
    if (idle.idle) {
      if (!wasIdleRef.current) {
        wasIdleRef.current = true
        idleBasisRef.current =
          status?.lastActivityAt ??
          (idle.idleSince != null ? new Date(idle.idleSince).toISOString() : null)
      }
      return
    }
    if (!wasIdleRef.current) return
    wasIdleRef.current = false
    void (async () => {
      const result = await getIdleGapAction(idleBasisRef.current)
      if (result.ok && result.data && dismissedGapRef.current !== result.data.dayEntryId) {
        setGap(result.data)
      }
      if (clockedInRef.current) void heartbeatAction()
    })()
    // status is read through the latest render - the effect keys on the flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle.idle])

  // Countdown expiry: close via the idle auto-close path (server records
  // autoClosed); the forgiveness dialog opens with the recorded gap.
  React.useEffect(() => {
    if (countdown == null || countdown > 0) return
    setCountdown(null)
    void (async () => {
      const result = await idleAutoClockOutAction()
      if (result.ok) applyStatus(result.data)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown])

  // Clock-C2 closed-while-away: once per clocked-out stretch, ask whether an
  // auto-closed session is waiting on a forgiveness decision (page load or
  // poll after the sweep/countdown closed it).
  React.useEffect(() => {
    if (status == null) return
    if (status.clockedIn) {
      closedGapCheckedRef.current = false
      return
    }
    if (gap != null || closedGapCheckedRef.current) return
    closedGapCheckedRef.current = true
    void (async () => {
      const result = await getIdleGapAction(null)
      if (result.ok && result.data && dismissedGapRef.current !== result.data.dayEntryId) {
        setGap(result.data)
      }
    })()
  }, [status, gap])

  React.useEffect(() => {
    if (!clockedIn) return
    const tick = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(tick)
  }, [clockedIn])

  // Clock-C2 heartbeat contract: the 60s interval runs only while the user
  // is ACTIVE (while idle the countdown owns the clock - stamping activity
  // would erase the idle stretch the forgiveness math needs), plus immediate
  // beats on visibility-return and window focus (the original's fix for
  // "tab switch clocks me out": a hidden tab's interval can starve).
  React.useEffect(() => {
    if (!clockedIn || idle.idle) return
    const beat = setInterval(() => void heartbeatAction(), HEARTBEAT_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void heartbeatAction()
    }
    const onFocus = () => void heartbeatAction()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [clockedIn, idle.idle])

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

  async function runStart(
    action: () => Promise<{ ok: true; data: TimerStartData } | { ok: false; error: string }>,
  ) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result.ok) {
        applyStatus(result.data.status)
        toastTimerSwitch(result.data.switch)
        setConfirmOut(false)
        setClientQuery('')
      } else {
        setError(result.error)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  // Clock-C2: apply one of the four forgiveness choices. The observed idle
  // baseline rides the call for the open case (the return heartbeat may have
  // stamped over the server's baseline); closed gaps are all server truth.
  async function chooseIdleResolution(choice: IdleForgivenessChoice) {
    if (gap == null) return
    setGapBusy(true)
    try {
      const result = await resolveIdleTimeAction(
        choice,
        gap.alreadyClosed ? null : idleBasisRef.current,
      )
      const { toast } = await import('sonner')
      if (result.ok) {
        applyStatus(result.data.status)
        const { outcome, restartedLabel } = result.data.result
        if (outcome === 'closed_at_idle_start') toast.success('Idle time discarded')
        else if (outcome === 'restarted') {
          toast.success(
            restartedLabel ? `Idle time discarded - back on ${restartedLabel}` : 'Idle time discarded - clocked back in',
          )
        } else if (outcome === 'idle_block_added') toast.success('Idle stretch logged as a separate entry')
        else if (outcome === 'kept') toast.success('Idle time kept')
        // The resolution is final for this day entry even before the server
        // audit marker is visible to the next gap fetch.
        dismissedGapRef.current = gap.dayEntryId
        setGap(null)
        setCountdown(null)
      } else {
        toast.error(result.error)
      }
    } finally {
      setGapBusy(false)
    }
  }

  const idleDialogs = (
    <>
      <IdleExplainerDialog
        open={idle.explainerOpen}
        onAccept={idle.acceptExplainer}
        onDecline={idle.declineExplainer}
      />
      <IdleCountdownModal open={countdown != null && clockedIn} secondsLeft={countdown ?? 0} />
      <IdleForgivenessDialog
        gap={gap}
        busy={gapBusy}
        onChoose={(choice) => void chooseIdleResolution(choice)}
        onDismiss={() => {
          dismissedGapRef.current = gap?.dayEntryId ?? null
          setGap(null)
        }}
      />
    </>
  )

  const activity = status?.currentActivity ?? null
  const openTimers = status?.openTaskTimers ?? []
  // The invariant leaves exactly one work timer: an activity, or - when a
  // task timer holds the work clock - the first (only) task timer.
  const taskTimer = activity == null ? (openTimers[0] ?? null) : null
  const currentClientId = activity?.clientId ?? taskTimer?.clientId ?? null

  /** The client a kind pick or client switch lands on: the running client,
   *  else the most recently worked, else the first of today's clients. */
  function defaultClientId(): number | null {
    if (currentClientId != null) return currentClientId
    const recent = clients?.find((c) => c.lastWorkedAt != null)
    if (recent) return recent.id
    return clients?.[0]?.id ?? null
  }

  function startClientTimer(client: ClockClientOption) {
    if (busy || client.id === currentClientId) return
    void runStart(() => startActivityAction(lastWorkKindRef.current, client.id))
  }

  function pickKind(type: NonDayActivityType) {
    const clientId = defaultClientId()
    if (clientId == null) {
      setError('Pick a client first - work time always belongs to a client.')
      return
    }
    void runStart(() => startActivityAction(type, clientId))
  }

  // "s" quick-switch: cycle today's + recent clients one tap at a time.
  React.useEffect(() => {
    if (!clockedIn) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 's' && e.key !== 'S') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      // Never fire inside an open menu/dialog (Radix renders these roles).
      if (document.querySelector('[role="menu"], [role="dialog"]')) return
      const recent = (clients ?? []).filter((c) => c.isToday || c.lastWorkedAt != null)
      if (recent.length === 0) return
      const index = recent.findIndex((c) => c.id === currentClientId)
      const next = recent[(index + 1) % recent.length]
      if (next.id === currentClientId) return
      e.preventDefault()
      startClientTimer(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockedIn, clients, status, busy])

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
      <>
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
        {idleDialogs}
      </>
    )
  }

  if (state === 'autoOut') {
    return (
      <>
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
        {idleDialogs}
      </>
    )
  }

  // state === 'in'
  const daySeconds =
    status?.dayStartedAt != null
      ? (Date.now() - new Date(status.dayStartedAt).getTime()) / 1000
      : (status?.dayElapsedMinutes ?? 0) * 60
  const activityMeta = activity ? ACTIVITY_META[activity.activityType as keyof typeof ACTIVITY_META] : null
  const onBreak = activity != null && isBreakActivityType(activity.activityType)
  const activitySeconds = activity
    ? (Date.now() - new Date(activity.startedAt).getTime()) / 1000
    : 0
  const filteredClients =
    clientQuery.trim().length > 0
      ? (clients ?? []).filter((c) => fuzzyMatch(c.name, clientQuery.trim())).slice(0, 8)
      : (clients ?? []).slice(0, 10)

  const triggerLabel = activity
    ? activity.clientName != null
      ? `On the clock: ${activity.clientName}${activityMeta ? `, ${activityMeta.label}` : ''}`
      : `On ${activityMeta?.label ?? 'break'}`
    : taskTimer
      ? `On the clock: ${taskTimer.clientName ?? 'client'}, task ${taskTimer.taskTitle}`
      : 'Pick a client to start timing'

  return (
    <>
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

      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void loadClients()
          else {
            setConfirmOut(false)
            setClientQuery('')
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-full max-w-72 items-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={triggerLabel}
            data-testid="clock-client"
            data-on-break={onBreak || undefined}
          >
            {activityMeta && activity ? (
              <>
                <activityMeta.Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {activity.clientName != null ? (
                  <span className="truncate font-medium text-foreground" data-testid="clock-client-name">
                    {activity.clientName}
                  </span>
                ) : null}
                <span className={cn('shrink-0', activity.clientName != null && 'hidden sm:inline')}>
                  {activity.clientName != null ? `· ${activityMeta.label}` : activityMeta.label}
                </span>
                <span className="tnum shrink-0 font-medium text-foreground" data-testid="clock-activity-elapsed">
                  {formatClock(activitySeconds)}
                </span>
              </>
            ) : taskTimer ? (
              <>
                {/* A task timer holds the work clock: client + task, ticking. */}
                <SquareCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {taskTimer.clientName != null ? (
                  <span className="truncate font-medium text-foreground" data-testid="clock-client-name">
                    {taskTimer.clientName}
                  </span>
                ) : null}
                <span className="hidden shrink-0 truncate sm:inline" data-testid="clock-task-title">
                  · {taskTimer.taskTitle}
                </span>
                <span className="tnum shrink-0 font-medium text-foreground" data-testid="clock-activity-elapsed">
                  {formatClock(
                    (Date.now() - new Date(taskTimer.startedAt).getTime()) / 1000,
                  )}
                </span>
              </>
            ) : (
              <span>Pick a client</span>
            )}
            <ChevronDown aria-hidden className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Client timer</DropdownMenuLabel>
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-input px-2">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search clients…"
                aria-label="Search clients"
                data-testid="clock-client-search"
                className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          {filteredClients.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              {clients == null ? 'Loading clients…' : 'No clients match.'}
            </p>
          ) : (
            filteredClients.map((client) => {
              const current = client.id === currentClientId
              return (
                <DropdownMenuItem
                  key={client.id}
                  disabled={busy || current}
                  onSelect={() => startClientTimer(client)}
                  className="gap-2"
                  data-testid="clock-client-option"
                  data-client-id={client.id}
                >
                  <span className="flex-1 truncate">{client.name}</span>
                  {client.isToday && (
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Today
                    </span>
                  )}
                  {current && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-on-track" />}
                </DropdownMenuItem>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Activity kind</DropdownMenuLabel>
          {WORK_ACTIVITY_TYPES.map((type) => {
            const meta = ACTIVITY_META[type]
            const current = !onBreak && activity?.activityType === type
            return (
              <DropdownMenuItem
                key={type}
                disabled={busy || current}
                onSelect={() => pickKind(type as NonDayActivityType)}
                className="gap-2"
              >
                <meta.Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1">{meta.label}</span>
                {current && <Check aria-hidden className="h-3.5 w-3.5 text-status-on-track" />}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Breaks and lunch</DropdownMenuLabel>
          {BREAK_ACTIVITY_TYPES.map((type) => {
            const meta = ACTIVITY_META[type]
            const current = activity?.activityType === type
            return (
              <DropdownMenuItem
                key={type}
                disabled={busy || current}
                onSelect={() => void runStart(() => startActivityAction(type as NonDayActivityType))}
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
                    {t.clientName ? ` (${t.clientName})` : ''}
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
      {idleDialogs}
    </>
  )
}
