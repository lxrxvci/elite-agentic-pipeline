import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UnifiedQueue, WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkstationQueue } from '../queue'

vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn().mockResolvedValue({ ok: true }),
}))

// Saved views persist server-side now; keep jsdom off the DB layer.
vi.mock('@/server/actions/saved-views', () => ({
  listSavedViewsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  saveSavedViewAction: vi.fn(),
  deleteSavedViewAction: vi.fn(),
  importSavedViewsAction: vi.fn().mockResolvedValue({ ok: true, data: { imported: 0 } }),
}))

// This jsdom build ships window.localStorage as a plain object - install a
// minimal in-memory Storage so the work-day preference persists.
function storageStub(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', { value: storageStub(), configurable: true })
  Object.defineProperty(window, 'sessionStorage', { value: storageStub(), configurable: true })
})

function card(partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id' | 'status'>): WorkCard {
  return {
    clientId: 1,
    clientName: 'Harborline Marine',
    title: `Card ${partial.kind} ${partial.id}`,
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-08-24',
    assigneeId: null,
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  }
}

// Monday 2026-08-24: the default work-day filter is Monday.
const mondayQueue: UnifiedQueue = {
  today: '2026-08-24',
  buckets: {
    overdue: [],
    due_today: [
      card({ kind: 'task', id: 1, status: 'due_today', title: 'Monday client task', clientWorkDay: 1, orderClass: 'periodic' }),
      card({ kind: 'task', id: 2, status: 'due_today', title: 'Tuesday client task', clientWorkDay: 2, orderClass: 'ad_hoc' }),
      card({ kind: 'task', id: 3, status: 'due_today', title: 'Unassigned client task', clientWorkDay: null, orderClass: 'ad_hoc' }),
    ],
    upcoming: [],
    waiting_on_client: [],
    deferred: [],
    gated: [],
  },
}

function renderQueue(queue: UnifiedQueue = mondayQueue) {
  return render(
    <TooltipProvider>
      <WorkstationQueue queue={queue} assignees={[]} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('WorkstationQueue work-day chips', () => {
  it("defaults to today's weekday and shows only that day's clients", () => {
    renderQueue()
    expect(screen.getByText('Monday client task')).toBeInTheDocument()
    expect(screen.queryByText('Tuesday client task')).not.toBeInTheDocument()
    expect(screen.queryByText('Unassigned client task')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-day-chip-1')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows per-day open-card counts on the chips', () => {
    renderQueue()
    expect(screen.getByTestId('work-day-chip-1')).toHaveTextContent('1')
    expect(screen.getByTestId('work-day-chip-2')).toHaveTextContent('1')
    expect(screen.getByTestId('work-day-chip-any')).toHaveTextContent('1')
    expect(screen.getByTestId('work-day-chip-all')).toHaveTextContent('3')
    expect(screen.getByTestId('work-day-chip-3')).toHaveTextContent('0')
  })

  it('All shows every client; Any day shows only unassigned-day clients', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('work-day-chip-all'))
    expect(screen.getByText('Monday client task')).toBeInTheDocument()
    expect(screen.getByText('Tuesday client task')).toBeInTheDocument()
    expect(screen.getByText('Unassigned client task')).toBeInTheDocument()

    await user.click(screen.getByTestId('work-day-chip-any'))
    expect(screen.queryByText('Monday client task')).not.toBeInTheDocument()
    expect(screen.queryByText('Tuesday client task')).not.toBeInTheDocument()
    expect(screen.getByText('Unassigned client task')).toBeInTheDocument()
  })

  it('persists the selection across remounts (localStorage)', async () => {
    const user = userEvent.setup()
    const first = renderQueue()
    await user.click(screen.getByTestId('work-day-chip-all'))
    first.unmount()

    renderQueue()
    // Stored 'all' beats the today default: everything renders.
    expect(screen.getByText('Tuesday client task')).toBeInTheDocument()
    expect(screen.getByTestId('work-day-chip-all')).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains an empty day and offers Show all days', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('work-day-chip-3')) // Wednesday: nobody
    expect(screen.getByText('No work scheduled for Wednesday.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all days' }))
    expect(screen.getByText('Tuesday client task')).toBeInTheDocument()
  })
})

describe('WorkstationQueue reconciliation readiness badges', () => {
  // Sunday 2026-08-23: the default filter is All, so every card renders.
  function badgeQueue(partial: Partial<WorkCard>): UnifiedQueue {
    return {
      today: '2026-08-23',
      buckets: {
        overdue: [],
        due_today: [
          card({
            kind: 'reconciliation',
            id: 9,
            status: 'due_today',
            title: 'Reconcile Operating Checking',
            orderClass: 'reconciliation',
            ...partial,
          }),
        ],
        upcoming: [],
        waiting_on_client: [],
        deferred: [],
        gated: [],
      },
    }
  }

  it('shows the Ready badge when statement uploaded and feeds settled', () => {
    renderQueue(badgeQueue({ readyToReconcile: true, statementAvailable: true }))
    expect(screen.getByTestId('recon-ready-badge')).toHaveTextContent('Ready')
    expect(screen.queryByTestId('recon-readiness-note')).not.toBeInTheDocument()
  })

  it('shows Waiting on statement when the statement is not uploaded', () => {
    renderQueue(badgeQueue({ readyToReconcile: false, statementAvailable: false }))
    expect(screen.getByTestId('recon-readiness-note')).toHaveTextContent('Waiting on statement')
    expect(screen.queryByTestId('recon-ready-badge')).not.toBeInTheDocument()
  })

  it('shows Feeds open when the statement is in but feeds are unsettled', () => {
    renderQueue(badgeQueue({ readyToReconcile: false, statementAvailable: true }))
    expect(screen.getByTestId('recon-readiness-note')).toHaveTextContent('Feeds open')
  })

  it('renders no readiness chrome on non-reconciliation cards', () => {
    const queue = badgeQueue({ readyToReconcile: false, statementAvailable: false })
    queue.buckets.due_today[0] = card({ kind: 'task', id: 10, status: 'due_today', title: 'Plain task' })
    renderQueue(queue)
    expect(screen.queryByTestId('recon-ready-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recon-readiness-note')).not.toBeInTheDocument()
  })
})
