import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UnifiedQueue, WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkstationQueue } from '../queue'

/**
 * Bumper lanes UI pins (D6/D7/D8): locked cards render the lock + reason
 * (never hidden), the complete affordance is replaced by the override
 * request, the state chip names the active client + stage, and the request
 * dialog posts the reason through the approvals action.
 */

const mockRequest = vi.fn()
vi.mock('@/server/actions/approvals', () => ({
  requestBumperOverrideAction: (...args: unknown[]) => mockRequest(...args),
}))

vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn(async () => ({ ok: true })),
}))

// Saved views read /api/saved-views on mount; stub an empty store.
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
)

function card(partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id' | 'status'>): WorkCard {
  return {
    clientId: 1,
    clientName: 'Blue Spruce Landscaping',
    title: `Card ${partial.kind} ${partial.id}`,
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-08-20',
    assigneeId: 1,
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  }
}

const LANE_QUEUE: UnifiedQueue = {
  today: '2026-08-23',
  bumperLanes: {
    enabled: true,
    activeClientId: 1,
    activeClientName: 'Blue Spruce Landscaping',
    activeStage: 'bank_feeds',
  },
  buckets: {
    overdue: [
      card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Bank feed week of 2026-08-17' }),
    ],
    due_today: [
      card({
        kind: 'task',
        id: 2,
        status: 'due_today',
        title: 'Rebecca onboarding call',
        clientId: 1,
        laneLocked: true,
        laneLockReason: "Finish Blue Spruce Landscaping's bank feeds first",
      }),
    ],
    upcoming: [
      card({
        kind: 'reconciliation',
        id: 3,
        status: 'upcoming',
        title: 'Reconcile Operating Checking',
        clientId: 2,
        clientName: 'Harborline Marine',
        laneLocked: true,
        laneLockReason: "Finish Blue Spruce Landscaping's bank feeds first",
        laneOverride: 'pending',
      }),
      card({
        kind: 'report',
        id: 4,
        status: 'upcoming',
        title: 'August management report',
        clientId: 2,
        clientName: 'Harborline Marine',
        laneLocked: false,
        laneOverride: 'active',
      }),
    ],
    waiting_on_client: [],
    deferred: [],
    gated: [],
  },
}

function renderQueue() {
  return render(
    <TooltipProvider>
      <WorkstationQueue queue={LANE_QUEUE} assignees={[{ id: 1, name: 'Sofia Reyes', initials: 'SR' }]} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  mockRequest.mockReset()
  mockRequest.mockResolvedValue({ ok: true, data: { requestId: 42 } })
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Bumper lanes on the workstation (D6/D8)', () => {
  it('shows the state chip naming the active client and stage', () => {
    renderQueue()
    const chip = screen.getByTestId('bumper-lanes-chip')
    expect(chip).toHaveTextContent('Bumper lanes')
    expect(chip).toHaveTextContent('Blue Spruce Landscaping')
    expect(chip).toHaveTextContent('bank feeds')
  })

  it('renders locked cards with the lock + reason instead of a complete button', () => {
    renderQueue()
    const lockedRow = screen
      .getAllByTestId('work-card')
      .find((el) => el.getAttribute('data-card-key') === 'task:2')!
    // Lock marker carries the reason; the complete button is gone.
    const lock = within(lockedRow as HTMLElement).getByTestId('lane-lock')
    expect(lock.getAttribute('data-reason')).toBe(
      "Finish Blue Spruce Landscaping's bank feeds first",
    )
    expect(within(lockedRow as HTMLElement).queryByRole('button', { name: /Complete:/ })).toBeNull()
    // The override request affordance replaces it.
    expect(
      within(lockedRow as HTMLElement).getByRole('button', { name: 'Request override: Rebecca onboarding call' }),
    ).toBeInTheDocument()
  })

  it('the unlocked in-lane card keeps its complete button', () => {
    renderQueue()
    const feedRow = screen
      .getAllByTestId('work-card')
      .find((el) => el.getAttribute('data-card-key') === 'bank_feed:1')!
    expect(within(feedRow as HTMLElement).getByRole('button', { name: /Complete:/ })).toBeInTheDocument()
  })

  it('a pending request reads as requested; an active grant unlocks the card', () => {
    renderQueue()
    const pendingRow = screen
      .getAllByTestId('work-card')
      .find((el) => el.getAttribute('data-card-key') === 'reconciliation:3')!
    expect(within(pendingRow as HTMLElement).getByTestId('override-pending')).toHaveTextContent(
      'Override requested',
    )
    expect(within(pendingRow as HTMLElement).queryByTestId('request-override')).toBeNull()

    const activeRow = screen
      .getAllByTestId('work-card')
      .find((el) => el.getAttribute('data-card-key') === 'report:4')!
    expect(within(activeRow as HTMLElement).getByTestId('lane-override-active')).toBeInTheDocument()
    expect(within(activeRow as HTMLElement).getByRole('button', { name: /Complete:/ })).toBeInTheDocument()
  })

  it('disables Complete next when the selected card is locked, with the reason as the title', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.keyboard('j') // move onto the locked task card
    const button = screen.getByTestId('complete-next')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', "Finish Blue Spruce Landscaping's bank feeds first")
  })
})

describe('Request override dialog (D7/L3)', () => {
  it('opens from the locked card and posts kind/id + reason', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByRole('button', { name: 'Request override: Rebecca onboarding call' }))

    const dialog = await screen.findByTestId('request-override-dialog')
    expect(dialog).toHaveTextContent('Rebecca onboarding call')
    expect(dialog).toHaveTextContent("Finish Blue Spruce Landscaping's bank feeds first")

    const submit = within(dialog).getByTestId('override-submit')
    expect(submit).toBeDisabled() // reason required
    await user.type(within(dialog).getByTestId('override-reason'), 'Client needs it today')
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(mockRequest).toHaveBeenCalledWith({ kind: 'task', id: 2 }, 'Client needs it today')
  })
})
