import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getClockStatusAction, startTaskTimerAction, stopTaskTimerAction } from '@/server/actions/time'
import { __resetClockStatusForTests } from '@/shared/lib/clock-status'
import type { ClockStatus } from '@/server/time-tracking'
import type { WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkCardRow } from '../work-card'

// The toggle dynamically imports the actions module - vitest intercepts it.
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn(),
  startTaskTimerAction: vi.fn(),
  stopTaskTimerAction: vi.fn(),
}))

const mockStatus = vi.mocked(getClockStatusAction)
const mockStart = vi.mocked(startTaskTimerAction)
const mockStop = vi.mocked(stopTaskTimerAction)

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

function taskCard(): WorkCard {
  return {
    kind: 'task',
    id: 42,
    clientId: 1,
    clientName: 'Harborline Marine',
    title: 'Reconcile August',
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-08-30',
    status: 'upcoming',
    assigneeId: 1,
    waitingOnClient: false,
    deferredUntil: null,
  }
}

function renderRow(card: WorkCard) {
  return render(
    <TooltipProvider>
      <WorkCardRow
        card={card}
        today="2026-08-23"
        selected={false}
        onSelect={() => {}}
        onComplete={() => {}}
      />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  __resetClockStatusForTests()
  mockStatus.mockResolvedValue({ ok: true, data: status({}) })
})

const RUNNING_TIMER = {
  entryId: 7,
  taskId: 42,
  taskTitle: 'Reconcile August',
  startedAt: new Date().toISOString(),
  elapsedMinutes: 0,
}

describe('WorkCardRow task timer', () => {
  it('renders the timer toggle only on task-kind cards', async () => {
    renderRow(taskCard())
    expect(
      await screen.findByRole('button', { name: /start task timer: reconcile august/i }),
    ).toBeInTheDocument()
  })

  it('does not render the toggle on non-task cards', () => {
    renderRow({ ...taskCard(), kind: 'bank_feed' })
    expect(screen.queryByTestId('task-timer-toggle')).not.toBeInTheDocument()
  })

  it('starts the timer and reflects the running state from the server', async () => {
    mockStart.mockResolvedValue({ ok: true, data: status({}) })
    // Mount reads empty timers; the post-toggle refresh reads them running.
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({}) })
      .mockResolvedValue({ ok: true, data: status({ openTaskTimers: [RUNNING_TIMER] }) })
    renderRow(taskCard())
    const toggle = await screen.findByTestId('task-timer-toggle')
    expect(toggle).toHaveAttribute('data-running', 'false')

    await userEvent.click(toggle)
    expect(mockStart).toHaveBeenCalledWith(42)
    await waitFor(() => expect(toggle).toHaveAttribute('data-running', 'true'))
    expect(
      screen.getByRole('button', { name: /stop task timer: reconcile august/i }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('stops a running timer', async () => {
    // Mount reads the running timer; the post-toggle refresh reads none.
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({ openTaskTimers: [RUNNING_TIMER] }) })
      .mockResolvedValue({ ok: true, data: status({}) })
    mockStop.mockResolvedValue({ ok: true, data: status({}) })
    renderRow(taskCard())

    const toggle = await screen.findByRole('button', { name: /stop task timer/i })
    await userEvent.click(toggle)
    expect(mockStop).toHaveBeenCalledWith(42)
    await waitFor(() =>
      expect(screen.getByTestId('task-timer-toggle')).toHaveAttribute('data-running', 'false'),
    )
  })

  it('resyncs from the server when the start is rejected (already running)', async () => {
    mockStart.mockResolvedValue({ ok: false, error: 'Task 42 already has a running timer' })
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({
        openTaskTimers: [
          {
            entryId: 7,
            taskId: 42,
            taskTitle: 'Reconcile August',
            startedAt: new Date().toISOString(),
            elapsedMinutes: 4,
          },
        ],
      }),
    })
    renderRow(taskCard())
    const toggle = await screen.findByTestId('task-timer-toggle')
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('data-running', 'true'))
  })
})
