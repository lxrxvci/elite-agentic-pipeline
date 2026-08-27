import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clockInAction,
  clockOutAction,
  getClockStatusAction,
  heartbeatAction,
  startActivityAction,
} from '@/server/actions/time'
import type { ClockStatus } from '@/server/time-tracking'

import { ClockWidget } from '../clock-widget'

vi.mock('@/server/actions/time', () => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  heartbeatAction: vi.fn(),
  startActivityAction: vi.fn(),
  getClockStatusAction: vi.fn(),
}))

const mockStatus = vi.mocked(getClockStatusAction)
const mockClockIn = vi.mocked(clockInAction)
const mockClockOut = vi.mocked(clockOutAction)
const mockStartActivity = vi.mocked(startActivityAction)
vi.mocked(heartbeatAction).mockResolvedValue({ ok: true, data: { touched: 1 } })

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

const clockedInStatus = status({
  clockedIn: true,
  dayStartedAt: new Date(Date.now() - 65 * 60_000).toISOString(),
  dayElapsedMinutes: 65,
  currentActivity: {
    entryId: 11,
    activityType: 'tasks',
    clientId: null,
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    elapsedMinutes: 20,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(heartbeatAction).mockResolvedValue({ ok: true, data: { touched: 1 } })
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

  it('clocked in: shows ticking elapsed and the current activity chip', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })

    render(<ClockWidget />)
    await screen.findByTestId('clock-elapsed')
    expect(screen.getByRole('button', { name: /current activity: tasks/i })).toBeInTheDocument()
    // 65 minutes -> h:mm:ss format with tabular numerals.
    expect(screen.getByTestId('clock-elapsed').textContent).toMatch(/^1:0\d:\d\d$/)
  })

  it('switches activity from the dropdown', async () => {
    mockStatus.mockResolvedValue({ ok: true, data: clockedInStatus })
    mockStartActivity.mockResolvedValue({
      ok: true,
      data: status({
        ...clockedInStatus,
        currentActivity: { ...clockedInStatus.currentActivity!, activityType: 'bank_feeds' },
      }),
    })

    render(<ClockWidget />)
    await userEvent.click(await screen.findByRole('button', { name: /current activity: tasks/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /bank feeds/i }))

    expect(mockStartActivity).toHaveBeenCalledWith('bank_feeds')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /current activity: bank feeds/i })).toBeInTheDocument(),
    )
  })

  it('confirms clock-out when task timers are open', async () => {
    const withTimer = status({
      ...clockedInStatus,
      openTaskTimers: [
        {
          entryId: 5,
          taskId: 42,
          taskTitle: 'Reconcile August',
          startedAt: new Date().toISOString(),
          elapsedMinutes: 9,
        },
      ],
    })
    mockStatus.mockResolvedValue({ ok: true, data: withTimer })
    mockClockOut.mockResolvedValue({ ok: true, data: status({}) })

    render(<ClockWidget />)
    await userEvent.click(await screen.findByRole('button', { name: /current activity: tasks/i }))
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
