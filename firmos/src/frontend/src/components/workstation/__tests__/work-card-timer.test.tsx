import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getClockStatusAction,
  startActivityAction,
  startTaskTimerAction,
  stopActivityAction,
  stopTaskTimerAction,
} from '@/server/actions/time'
import { __resetClockStatusForTests } from '@/shared/lib/clock-status'
import type { ClockStatus } from '@/server/time-tracking'
import type { WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkCardRow } from '../work-card'

// The control dynamically imports the actions module - vitest intercepts it.
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn(),
  startTaskTimerAction: vi.fn(),
  stopTaskTimerAction: vi.fn(),
  startActivityAction: vi.fn(),
  stopActivityAction: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockStatus = vi.mocked(getClockStatusAction)
const mockStart = vi.mocked(startTaskTimerAction)
const mockStop = vi.mocked(stopTaskTimerAction)
const mockStartActivity = vi.mocked(startActivityAction)
const mockStopActivity = vi.mocked(stopActivityAction)

function status(partial: Partial<ClockStatus>): ClockStatus {
  return {
    clockedIn: true,
    dayStartedAt: new Date().toISOString(),
    dayElapsedMinutes: 30,
    currentActivity: null,
    openTaskTimers: [],
    lastActivityAt: null,
    idleTimeoutMinutes: 15,
    ...partial,
  }
}

/** Clock-C1 start payload: status + the invariant's switch report. */
const started = (next: ClockStatus) => ({ ok: true as const, data: { status: next, switch: { stopped: [] } } })

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
  clientId: 1,
  clientName: 'Harborline Marine',
  startedAt: new Date().toISOString(),
  elapsedMinutes: 0,
}

const RUNNING_ACTIVITY = {
  entryId: 9,
  activityType: 'bank_feeds',
  clientId: 1,
  clientName: 'Harborline Marine',
  referenceType: 'bank_feed',
  referenceId: 50,
  startedAt: new Date().toISOString(),
  elapsedMinutes: 0,
}

describe('WorkCardRow card timer (D5 timeboxing)', () => {
  it('renders the estimate chip on every kind, from the shared table', () => {
    renderRow(taskCard())
    expect(screen.getByTestId('estimate-chip')).toHaveTextContent('≈25m')
    renderRow({ ...taskCard(), kind: 'bank_feed', id: 43 })
    expect(screen.getAllByTestId('estimate-chip')[1]).toHaveTextContent('≈15m')
  })

  it('renders the Start action on task and periodic cards alike', async () => {
    renderRow(taskCard())
    expect(
      await screen.findByRole('button', { name: /start timer: reconcile august/i }),
    ).toBeInTheDocument()
  })

  it('starts the task timer and reflects the running state from the server', async () => {
    mockStart.mockResolvedValue(started(status({})))
    // Mount reads empty timers; the post-toggle refresh reads them running.
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({}) })
      .mockResolvedValue({ ok: true, data: status({ openTaskTimers: [RUNNING_TIMER] }) })
    renderRow(taskCard())
    const start = await screen.findByTestId('card-timer-start')

    await userEvent.click(start)
    expect(mockStart).toHaveBeenCalledWith(42)
    await waitFor(() =>
      expect(screen.getByTestId('card-timer-running')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /stop timer: reconcile august/i }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('stops a running task timer', async () => {
    // Mount reads the running timer; the post-toggle refresh reads none.
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({ openTaskTimers: [RUNNING_TIMER] }) })
      .mockResolvedValue({ ok: true, data: status({}) })
    mockStop.mockResolvedValue({ ok: true, data: status({}) })
    renderRow(taskCard())

    const stop = await screen.findByRole('button', { name: /stop timer/i })
    await userEvent.click(stop)
    expect(mockStop).toHaveBeenCalledWith(42)
    await waitFor(() =>
      expect(screen.getByTestId('card-timer-start')).toBeInTheDocument(),
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
            clientId: 1,
            clientName: 'Harborline Marine',
            startedAt: new Date().toISOString(),
            elapsedMinutes: 4,
          },
        ],
      }),
    })
    renderRow(taskCard())
    const start = await screen.findByTestId('card-timer-start')
    await userEvent.click(start)
    await waitFor(() =>
      expect(screen.getByTestId('card-timer-running')).toBeInTheDocument(),
    )
  })

  it('periodic cards drive the activity timer (kind-mapped, client-scoped, reference-stamped)', async () => {
    mockStartActivity.mockResolvedValue(started(status({})))
    mockStatus
      .mockResolvedValueOnce({ ok: true, data: status({}) })
      .mockResolvedValue({ ok: true, data: status({ currentActivity: RUNNING_ACTIVITY }) })
    renderRow({ ...taskCard(), kind: 'bank_feed', id: 50, title: 'Bank feed week of 2026-08-17' })

    const start = await screen.findByTestId('card-timer-start')
    await userEvent.click(start)
    // bank_feed maps to the bank_feeds activity with the card's client AND
    // the periodic row's reference (Clock-C1).
    expect(mockStartActivity).toHaveBeenCalledWith('bank_feeds', 1, 'bank_feed', 50)
    await waitFor(() =>
      expect(screen.getByTestId('card-timer-running')).toBeInTheDocument(),
    )

    mockStopActivity.mockResolvedValue({ ok: true, data: status({}) })
    mockStatus.mockResolvedValue({ ok: true, data: status({}) })
    await userEvent.click(screen.getByTestId('card-timer-running'))
    expect(mockStopActivity).toHaveBeenCalledWith('bank_feeds', 1)
    await waitFor(() =>
      expect(screen.getByTestId('card-timer-start')).toBeInTheDocument(),
    )
  })

  it('marks only the referenced row running when the timer stamps a reference', async () => {
    // The timer runs on week row 50; the same client's week row 51 must not
    // light up (reference beats bare-client matching).
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({ currentActivity: RUNNING_ACTIVITY }),
    })
    renderRow({ ...taskCard(), kind: 'bank_feed', id: 51 })
    expect(await screen.findByTestId('card-timer-start')).toBeInTheDocument()
    expect(screen.queryByTestId('card-timer-running')).not.toBeInTheDocument()
  })

  it('a client clock with no reference still matches the client’s cards', async () => {
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({
        currentActivity: { ...RUNNING_ACTIVITY, referenceType: null, referenceId: null },
      }),
    })
    renderRow({ ...taskCard(), kind: 'bank_feed', id: 51 })
    expect(await screen.findByTestId('card-timer-running')).toBeInTheDocument()
  })

  it('does not mark a card running for another client’s activity', async () => {
    mockStatus.mockResolvedValue({
      ok: true,
      data: status({ currentActivity: { ...RUNNING_ACTIVITY, clientId: 999, referenceType: null, referenceId: null } }),
    })
    renderRow({ ...taskCard(), kind: 'bank_feed', id: 51 })
    expect(await screen.findByTestId('card-timer-start')).toBeInTheDocument()
    expect(screen.queryByTestId('card-timer-running')).not.toBeInTheDocument()
  })
})
