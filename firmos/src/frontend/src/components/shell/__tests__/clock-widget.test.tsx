import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clockInAction,
  clockOutAction,
  getClockStatusAction,
  heartbeatAction,
  listClockClientsAction,
  startActivityAction,
} from '@/server/actions/time'
import type { ClockClientOption, ClockStatus } from '@/server/time-tracking'

import { ClockWidget } from '../clock-widget'

vi.mock('@/server/actions/time', () => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  heartbeatAction: vi.fn(),
  startActivityAction: vi.fn(),
  getClockStatusAction: vi.fn(),
  listClockClientsAction: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockStatus = vi.mocked(getClockStatusAction)
const mockClockIn = vi.mocked(clockInAction)
const mockClockOut = vi.mocked(clockOutAction)
const mockStartActivity = vi.mocked(startActivityAction)
const mockClients = vi.mocked(listClockClientsAction)
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
