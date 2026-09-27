import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
} from '@/server/actions/time'
import type { ClockClientOption, ClockStatus, IdleGap } from '@/server/time-tracking'

import { ClockWidget } from '../clock-widget'

vi.mock('@/server/actions/time', () => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  heartbeatAction: vi.fn(),
  startActivityAction: vi.fn(),
  getClockStatusAction: vi.fn(),
  listClockClientsAction: vi.fn(),
  getIdleGapAction: vi.fn(),
  idleAutoClockOutAction: vi.fn(),
  resolveIdleTimeAction: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockStatus = vi.mocked(getClockStatusAction)
const mockClockIn = vi.mocked(clockInAction)
const mockClockOut = vi.mocked(clockOutAction)
const mockStartActivity = vi.mocked(startActivityAction)
const mockClients = vi.mocked(listClockClientsAction)
const mockHeartbeat = vi.mocked(heartbeatAction)
const mockGetIdleGap = vi.mocked(getIdleGapAction)
const mockIdleAutoClockOut = vi.mocked(idleAutoClockOutAction)
const mockResolveIdleTime = vi.mocked(resolveIdleTimeAction)
vi.mocked(heartbeatAction).mockResolvedValue({ ok: true, data: { touched: 1 } })

const CLIENTS: ClockClientOption[] = [
  { id: 1, name: 'Harborline Marine Supply', isToday: true, lastWorkedAt: null },
  { id: 2, name: 'Blue Spruce Ventures', isToday: false, lastWorkedAt: new Date().toISOString() },
]

function status(partial: Partial<ClockStatus>): ClockStatus {
  return {
    clockedIn: false,
    dayStartedAt: null,
    dayElapsedMinutes: 0,
    currentActivity: null,
    openTaskTimers: [],
    lastActivityAt: null,
    idleTimeoutMinutes: 15,
    ...partial,
  }
}

const RUNNING_ACTIVITY = {
  entryId: 11,
  activityType: 'tasks',
  clientId: 1,
  clientName: 'Harborline Marine Supply',
  referenceType: null,
  referenceId: null,
  startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  elapsedMinutes: 20,
}

const clockedInStatus = status({
  clockedIn: true,
  dayStartedAt: new Date(Date.now() - 65 * 60_000).toISOString(),
  dayElapsedMinutes: 65,
  currentActivity: RUNNING_ACTIVITY,
})

const cleanStart = (next: ClockStatus) => ({ ok: true as const, data: { status: next, switch: { stopped: [] } } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(heartbeatAction).mockResolvedValue({ ok: true, data: { touched: 1 } })
  mockClients.mockResolvedValue({ ok: true, data: CLIENTS })
  // Clock-C2 defaults: no pending forgiveness gap, auto-close + resolve succeed.
  mockGetIdleGap.mockResolvedValue({ ok: true, data: null })
  mockIdleAutoClockOut.mockResolvedValue({ ok: true, data: status({}) })
  mockResolveIdleTime.mockResolvedValue({
    ok: true,
    data: {
      status: status({}),
      result: { resolved: true, choice: 'keep', outcome: 'kept', restartedLabel: null },
    },
  })
})

describe('ClockWidget', () => {
  it('clocked out: shows Not clocked in and clocks in on click', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: status({}) })
    mockClockIn.mockResolvedValue({ ok: true, data: clockedInStatus })

    render(<ClockWidget />)
    const button = await screen.findByRole('button', { name: /not clocked in/i })
    expect(screen.getByTestId('clock-widget')).toHaveAttribute('data-state', 'out')

    await userEvent.click(button)
    expect(mockClockIn).toHaveBeenCalledTimes(1)
    // After the action the widget re-reads the returned status - clocked in.
    expect(await screen.findByTestId('clock-widget')).toHaveAttribute('data-state', 'in')
    expect(screen.getByTestId('clock-elapsed')).toBeInTheDocument()
  })

  it('clocked in: shows the client name with ticking elapsed and the day total', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })

    render(<ClockWidget />)
    await screen.findByTestId('clock-elapsed')
    // Client-first: the chip leads with the client name + kind + its own timer.
    expect(screen.getByTestId('clock-client-name')).toHaveTextContent('Harborline Marine Supply')
    expect(screen.getByRole('button', { name: /on the clock: harborline marine supply, tasks/i })).toBeInTheDocument()
    expect(screen.getByTestId('clock-activity-elapsed').textContent).toMatch(/^2\d:\d\d$/)
    // The day total keeps ticking in the green segment (65 minutes -> h:mm:ss).
    expect(screen.getByTestId('clock-elapsed').textContent).toMatch(/^1:0\d:\d\d$/)
  })

  it('widget_switch_stamps_client', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    const switched = status({
      ...clockedInStatus,
      currentActivity: {
        ...RUNNING_ACTIVITY,
        clientId: 2,
        clientName: 'Blue Spruce Ventures',
      },
    })
    mockStartActivity.mockResolvedValue({
      ok: true,
      data: {
        status: switched,
        switch: {
          stopped: [
            {
              kind: 'activity',
              entryId: 11,
              activityType: 'tasks',
              clientId: 1,
              clientName: 'Harborline Marine Supply',
              label: 'Harborline Marine Supply',
            },
          ],
        },
      },
    })

    render(<ClockWidget />)
    await userEvent.click(await screen.findByTestId('clock-client'))
    await userEvent.click(screen.getByRole('menuitem', { name: /blue spruce ventures/i }))

    // One tap on the client switches the timer: the start carries the client
    // and resumes the running kind.
    expect(mockStartActivity).toHaveBeenCalledWith('tasks', 2)
    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalledWith('Stopped Harborline Marine Supply and switched')
    await waitFor(() =>
      expect(screen.getByTestId('clock-client-name')).toHaveTextContent('Blue Spruce Ventures'),
    )
  })

  it('fuzzy-searches the client list', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })

    render(<ClockWidget />)
    await userEvent.click(await screen.findByTestId('clock-client'))
    await userEvent.type(screen.getByTestId('clock-client-search'), 'spruce')
    const options = screen.getAllByTestId('clock-client-option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Blue Spruce Ventures')
  })

  it('kind picks start on the current client; breaks start client-less', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    mockStartActivity.mockResolvedValue(cleanStart(clockedInStatus))

    render(<ClockWidget />)
    await userEvent.click(await screen.findByTestId('clock-client'))
    await userEvent.click(screen.getByRole('menuitem', { name: /bank feeds/i }))
    // The activity start ALWAYS carries a client (the running one).
    expect(mockStartActivity).toHaveBeenCalledWith('bank_feeds', 1)

    mockStartActivity.mockClear()
    await userEvent.click(await screen.findByTestId('clock-client'))
    await userEvent.click(screen.getByRole('menuitem', { name: /lunch \(unpaid\)/i }))
    // Breaks stay client-agnostic.
    expect(mockStartActivity).toHaveBeenCalledWith('lunch_unpaid')
  })

  it('kind picks fall back to the most recent client when nothing is running', async () => {
    const noActivity = status({ ...clockedInStatus, currentActivity: null })
    mockStatus.mockResolvedValue({ ok: true, data: noActivity })
    mockStartActivity.mockResolvedValue(cleanStart(clockedInStatus))

    render(<ClockWidget />)
    await userEvent.click(await screen.findByRole('button', { name: /pick a client to start timing/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /reconciliations/i }))
    // No current client: the picker defaults to the most recently worked one.
    expect(mockStartActivity).toHaveBeenCalledWith('reconciliations', 2)
  })

  it('"s" quick-switches to the next recent client and skips typing targets', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    mockStartActivity.mockResolvedValue(cleanStart(clockedInStatus))

    render(<ClockWidget />)
    await screen.findByTestId('clock-client-name')
    // Wait for the client list to land (the hotkey reads it).
    await waitFor(() => expect(mockClients).toHaveBeenCalled())

    // Current client is id 1; the next in recency order is id 2.
    await userEvent.keyboard('s')
    await waitFor(() => expect(mockStartActivity).toHaveBeenCalledWith('tasks', 2))
  })

  it('shows the task timer as the current clock when one holds the work timer', async () => {
    // The invariant: a task timer start closes the open activity, so the
    // widget must surface the task's client + title as the current clock.
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({
        ...clockedInStatus,
        currentActivity: null,
        openTaskTimers: [
          {
            entryId: 5,
            taskId: 42,
            taskTitle: 'Reconcile August',
            clientId: 2,
            clientName: 'Blue Spruce Ventures',
            startedAt: new Date(Date.now() - 7 * 60_000).toISOString(),
            elapsedMinutes: 7,
          },
        ],
      }),
    })

    render(<ClockWidget />)
    await screen.findByTestId('clock-elapsed')
    expect(screen.getByTestId('clock-client-name')).toHaveTextContent('Blue Spruce Ventures')
    expect(screen.getByTestId('clock-task-title')).toHaveTextContent('Reconcile August')
    expect(screen.getByTestId('clock-activity-elapsed').textContent).toMatch(/^0[67]:\d\d$/)
    expect(
      screen.getByRole('button', { name: /on the clock: blue spruce ventures, task reconcile august/i }),
    ).toBeInTheDocument()
  })

  it('confirms clock-out when task timers are open', async () => {
    const withTimer = status({
      ...clockedInStatus,
      openTaskTimers: [
        {
          entryId: 5,
          taskId: 42,
          taskTitle: 'Reconcile August',
          clientId: 1,
          clientName: 'Harborline Marine Supply',
          startedAt: new Date().toISOString(),
          elapsedMinutes: 9,
        },
      ],
    })
    mockStatus.mockResolvedValue({ ok: true, data: withTimer })
    mockClockOut.mockResolvedValue({ ok: true, data: status({}) })

    render(<ClockWidget />)
    await userEvent.click(await screen.findByTestId('clock-client'))
    // First click arms the confirm instead of clocking out.
    await userEvent.click(screen.getByRole('menuitem', { name: /^clock out$/i }))
    expect(mockClockOut).not.toHaveBeenCalled()
    const confirm = screen.getByRole('menuitem', { name: /confirm - stops 1 task timer/i })
    await userEvent.click(confirm)
    expect(mockClockOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('clock-widget')).toHaveAttribute('data-state', 'out')
  })

  it('shows the clock-back-in state when the server closed the session', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    render(<ClockWidget pollMs={50} />)
    await screen.findByTestId('clock-elapsed')

    // Next poll: the stale-cleanup closed the day (no local clock-out).
    mockStatus.mockResolvedValue({ ok: true, data: status({}) })

    await waitFor(() =>
      expect(screen.getByTestId('clock-widget')).toHaveAttribute('data-state', 'auto-out'),
    )
    expect(screen.getByText(/clocked out automatically/i)).toBeInTheDocument()

    mockClockIn.mockResolvedValue({ ok: true, data: clockedInStatus })
    await userEvent.click(screen.getByRole('button', { name: /clock back in/i }))
    expect(mockClockIn).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByTestId('clock-widget')).toHaveAttribute('data-state', 'in'),
    )
  })
})

/** An open-session gap (the entry still runs; the user came back). */
function openGap(partial: Partial<IdleGap> = {}): IdleGap {
  return {
    dayEntryId: 41,
    idleStartedAt: new Date(Date.now() - 17 * 60_000).toISOString(),
    gapEndAt: new Date().toISOString(),
    idleMinutes: 15,
    alreadyClosed: false,
    activityType: 'tasks',
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    referenceType: null,
    referenceId: null,
    taskId: null,
    taskTitle: null,
    ...partial,
  }
}

describe('ClockWidget - Clock-C2 idle system', () => {
  it('idle past threshold shows the countdown modal; any activity cancels it into the 4-choice forgiveness dialog', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    mockGetIdleGap.mockResolvedValue({ ok: true, data: openGap() })

    // jsdom has no IdleDetector: this is the fallback path (and no explainer).
    render(<ClockWidget idleThresholdMs={150} countdownSeconds={5} />)
    await screen.findByTestId('clock-elapsed')
    expect(screen.queryByTestId('idle-explainer-dialog')).not.toBeInTheDocument()

    const modal = await screen.findByTestId('idle-countdown-modal', {}, { timeout: 3000 })
    expect(modal).toHaveTextContent(/still there/i)
    expect(screen.getByTestId('idle-countdown-time').textContent).toMatch(/^00:0[1-5]$/)

    // Any activity cancels the countdown - and the return opens the
    // forgiveness dialog with the gap pre-computed.
    fireEvent.keyDown(window, { key: 'a' })
    const dialog = await screen.findByTestId('idle-forgiveness-dialog')
    expect(screen.queryByTestId('idle-countdown-modal')).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent(/welcome back/i)
    expect(screen.getByTestId('idle-forgiveness-desc')).toHaveTextContent(
      /away for 15 min while clocked in on Harborline Marine Supply/i,
    )
    // Exactly the four Toggl choices.
    expect(screen.getByTestId('idle-choice-discard')).toHaveTextContent('Discard idle time')
    expect(screen.getByTestId('idle-choice-discard-continue')).toHaveTextContent('Discard & continue')
    expect(screen.getByTestId('idle-choice-add-entry')).toHaveTextContent('Add idle as separate entry')
    expect(screen.getByTestId('idle-choice-keep')).toHaveTextContent('Keep idle time')

    // The observed idle baseline rode the gap call (the return heartbeat may
    // already have stamped over the server's baseline).
    expect(mockGetIdleGap).toHaveBeenCalledWith(expect.any(String))

    // The server never re-offers a resolved gap (the audit marker) - the
    // mock mirrors that once the choice lands.
    mockGetIdleGap.mockResolvedValue({ ok: true, data: null })
    await userEvent.click(screen.getByTestId('idle-choice-keep'))
    expect(mockResolveIdleTime).toHaveBeenCalledWith('keep', expect.any(String))
    await waitFor(() =>
      expect(screen.queryByTestId('idle-forgiveness-dialog')).not.toBeInTheDocument(),
    )
    // The return also heartbeats to hold the session open.
    expect(mockHeartbeat).toHaveBeenCalled()
  })

  it('countdown expiry closes the session through the idle auto-close path', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    mockIdleAutoClockOut.mockResolvedValue({ ok: true, data: status({}) })

    render(<ClockWidget idleThresholdMs={150} countdownSeconds={1} />)
    await screen.findByTestId('idle-countdown-modal', {}, { timeout: 3000 })

    await waitFor(() => expect(mockIdleAutoClockOut).toHaveBeenCalledTimes(1), { timeout: 4000 })
    // The returned status flips the widget to the auto-out re-clock state.
    await waitFor(() =>
      expect(screen.getByTestId('clock-widget')).toHaveAttribute('data-state', 'auto-out'),
    )
  })

  it('closed while away: the forgiveness dialog opens on load and discard & continue re-clocks', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: status({}) })
    mockGetIdleGap.mockResolvedValue({
      ok: true,
      data: openGap({ alreadyClosed: true, idleMinutes: 25 }),
    })
    mockResolveIdleTime.mockResolvedValue({
      ok: true,
      data: {
        status: clockedInStatus,
        result: {
          resolved: true,
          choice: 'discard_continue',
          outcome: 'restarted',
          restartedLabel: 'Harborline Marine Supply',
        },
      },
    })

    render(<ClockWidget />)
    const dialog = await screen.findByTestId('idle-forgiveness-dialog')
    expect(screen.getByTestId('idle-forgiveness-desc')).toHaveTextContent(
      /the clock closed while you were away and kept 25 min of idle time on Harborline Marine Supply/i,
    )

    await userEvent.click(screen.getByTestId('idle-choice-discard-continue'))
    // Closed gap: all server truth, no client baseline rides the call.
    expect(mockResolveIdleTime).toHaveBeenCalledWith('discard_continue', null)
    const { toast } = await import('sonner')
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Idle time discarded - back on Harborline Marine Supply'),
    )
    await waitFor(() =>
      expect(screen.getByTestId('clock-widget')).toHaveAttribute('data-state', 'in'),
    )
    expect(dialog).not.toBeInTheDocument()
  })

  it('focus and visibility-return fire immediate heartbeats', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    render(<ClockWidget />)
    await screen.findByTestId('clock-elapsed')
    mockHeartbeat.mockClear()

    fireEvent(window, new Event('focus'))
    expect(mockHeartbeat).toHaveBeenCalledTimes(1)
    fireEvent(document, new Event('visibilitychange')) // jsdom: visible
    expect(mockHeartbeat).toHaveBeenCalledTimes(2)
  })

  it('pauses the 60s heartbeat while idle, resumes (with an immediate beat) on return', async () => {
    vi.useFakeTimers()
    try {
      mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
      mockGetIdleGap.mockResolvedValue({ ok: true, data: openGap() })
      render(<ClockWidget pollMs={3_600_000} idleThresholdMs={100} countdownSeconds={600} />)
      // Flush the initial status fetch (fake timers: no findBy/waitFor).
      await act(async () => {})
      expect(screen.getByTestId('clock-elapsed')).toBeInTheDocument()
      mockHeartbeat.mockClear()

      // Go idle (fallback check interval ~50ms), then sit idle for minutes:
      // the interval beat must NOT stamp activity over the idle stretch.
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      await act(async () => {
        vi.advanceTimersByTime(3 * 60_000)
      })
      expect(mockHeartbeat).not.toHaveBeenCalled()

      // Return: one immediate beat (after the gap fetch), then the 60s
      // interval resumes.
      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })
      await act(async () => {})
      await act(async () => {})
      expect(mockHeartbeat).toHaveBeenCalledTimes(1)
      await act(async () => {
        vi.advanceTimersByTime(60_000)
      })
      expect(mockHeartbeat).toHaveBeenCalledTimes(2)
      // (The countdown modal's close on return is covered with real timers
      // in the countdown test above; Radix's exit animation needs them.)
    } finally {
      vi.useRealTimers()
    }
  })

  it('IdleDetector explainer: grant starts the detector, which drives the countdown', async () => {
    // A minimal IdleDetector stand-in: the hook must explain once, request
    // the permission in the click gesture, then run the detector.
    const instances: FakeIdleDetector[] = []
    class FakeIdleDetector {
      static requestPermission = vi.fn().mockResolvedValue('granted')
      userState: 'active' | 'idle' = 'active'
      private listeners: (() => void)[] = []
      constructor() {
        instances.push(this)
      }
      addEventListener(_: string, listener: () => void) {
        this.listeners.push(listener)
      }
      removeEventListener() {}
      start = vi.fn().mockResolvedValue(undefined)
      fireChange() {
        for (const listener of this.listeners) listener()
      }
    }
    const win = window as unknown as { IdleDetector?: unknown }
    const saved = win.IdleDetector
    win.IdleDetector = FakeIdleDetector
    const clearExplainer = () => {
      try {
        window.localStorage.removeItem('firmos.idle-explainer-v1')
      } catch {
        // jsdom storage can be opaque - the hook's own access is guarded too.
      }
    }
    clearExplainer()
    try {
      mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
      render(<ClockWidget idleThresholdMs={150} countdownSeconds={5} />)
      await screen.findByTestId('clock-elapsed')

      // First run: the explainer asks instead of silently prompting.
      const explainer = await screen.findByTestId('idle-explainer-dialog')
      expect(explainer).toHaveTextContent(/detect when you step away/i)

      await userEvent.click(screen.getByTestId('idle-explainer-accept'))
      expect(FakeIdleDetector.requestPermission).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(instances.length).toBe(1))
      expect(instances[0].start).toHaveBeenCalled()

      // The detector reports active -> idle: the countdown modal shows.
      await act(async () => {
        instances[0].userState = 'idle'
        instances[0].fireChange()
      })
      await screen.findByTestId('idle-countdown-modal', {}, { timeout: 3000 })

      // ...and back to active: the return opens the forgiveness flow.
      mockGetIdleGap.mockResolvedValue({ ok: true, data: openGap() })
      await act(async () => {
        instances[0].userState = 'active'
        instances[0].fireChange()
      })
      await screen.findByTestId('idle-forgiveness-dialog')
    } finally {
      win.IdleDetector = saved
      clearExplainer()
    }
  })
})
