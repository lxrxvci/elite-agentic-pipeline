import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getClockStatusAction, startActivityAction, stopActivityAction } from '@/server/actions/time'
import { __resetClockStatusForTests } from '@/shared/lib/clock-status'
import type { ClockStatus } from '@/server/time-tracking'

import { ClientClockChip } from '../client-clock-chip'

vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn(),
  startActivityAction: vi.fn(),
  stopActivityAction: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockStatus = vi.mocked(getClockStatusAction)
const mockStart = vi.mocked(startActivityAction)
const mockStop = vi.mocked(stopActivityAction)

function status(partial: Partial<ClockStatus>): ClockStatus {
  return {
    clockedIn: true,
    dayStartedAt: new Date().toISOString(),
    dayElapsedMinutes: 30,
    currentActivity: null,
    openTaskTimers: [],
    lastActivityAt: null,
    ...partial,
  }
}

const RUNNING_ON_CLIENT = {
  entryId: 9,
  activityType: 'tasks',
  clientId: 7,
  clientName: 'Harborline Marine Supply',
  referenceType: null,
  referenceId: null,
  startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
  elapsedMinutes: 42,
}

beforeEach(() => {
  vi.resetAllMocks()
  __resetClockStatusForTests()
})

describe('ClientClockChip', () => {
  it('idle: "Clock in to this client" starts the client timer', async () => {
    // Mount reads idle; the post-start store refresh reads the running timer.
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({}) })
      .mockResolvedValue({ ok: true, data: status({ currentActivity: RUNNING_ON_CLIENT }) })
    mockStart.mockResolvedValue({
      ok: true,
      data: { status: status({ currentActivity: RUNNING_ON_CLIENT }), switch: { stopped: [] } },
    })
    render(<ClientClockChip clientId={7} />)

    const chip = await screen.findByTestId('client-clock-chip')
    expect(chip).toHaveAttribute('data-state', 'idle')

    await userEvent.click(chip)
    expect(mockStart).toHaveBeenCalledWith('tasks', 7)
    await waitFor(() =>
      expect(screen.getByTestId('client-clock-chip')).toHaveAttribute('data-state', 'running'),
    )
    expect(screen.getByTestId('client-clock-chip')).toHaveTextContent(/on the clock · 4\dm/i)
  })

  it('running: shows "On the clock · 42m" and stops on click', async () => {
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({ currentActivity: RUNNING_ON_CLIENT }) })
      .mockResolvedValue({ ok: true, data: status({}) })
    mockStop.mockResolvedValue({ ok: true, data: status({}) })
    render(<ClientClockChip clientId={7} />)

    const chip = await screen.findByRole('button', { name: /on the clock for this client/i })
    expect(chip).toHaveTextContent('On the clock · 42m')

    await userEvent.click(chip)
    expect(mockStop).toHaveBeenCalledWith('tasks', 7)
    await waitFor(() =>
      expect(screen.getByTestId('client-clock-chip')).toHaveAttribute('data-state', 'idle'),
    )
  })

  it('stays idle while another client or a break is on the clock', async () => {
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({ currentActivity: { ...RUNNING_ON_CLIENT, clientId: 999 } }),
    })
    render(<ClientClockChip clientId={7} />)
    expect(await screen.findByTestId('client-clock-chip')).toHaveAttribute('data-state', 'idle')

    mockStatus.mockResolvedValue({
      ok: true,
      data: status({
        currentActivity: { ...RUNNING_ON_CLIENT, activityType: 'lunch_unpaid', clientId: null, clientName: null },
      }),
    })
    render(<ClientClockChip clientId={7} />)
    await waitFor(() =>
      expect(screen.getAllByTestId('client-clock-chip')[1]).toHaveAttribute('data-state', 'idle'),
    )
  })
})
