import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { completeWorkCard } from '@/server/actions/work'
import type { CompleteWorkCardResult } from '@/server/actions/work'
import type { UnifiedQueue, WorkCard } from '@/server/queue'
import { TooltipProvider } from '@/components/ui/tooltip'

import { WorkstationQueue } from '../queue'

vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn(),
}))

// Saved views persist server-side now; an in-memory store keeps these tests
// focused on the queue. (The module's own seam tests mock the same actions.)
vi.mock('@/server/actions/saved-views', () => {
  let seq = 0
  let store: { id: number; name: string; context: string; filters: unknown; position: number }[] = []
  return {
    __resetSavedViews: () => {
      store = []
    },
    listSavedViewsAction: vi.fn(async () => ({ ok: true as const, data: store })),
    saveSavedViewAction: vi.fn(async (_context: string, name: string, filters: unknown) => {
      if (store.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false as const, error: `A view named "${name}" already exists - pick another name.` }
      }
      seq += 1
      const record = { id: seq, name, context: 'workstation', filters, position: seq }
      store = [...store, record]
      return { ok: true as const, data: record }
    }),
    deleteSavedViewAction: vi.fn(async (_context: string, name: string) => {
      store = store.filter((v) => v.name !== name)
      return { ok: true as const, data: { deleted: true as const } }
    }),
    importSavedViewsAction: vi.fn(async () => ({ ok: true as const, data: { imported: 0 } })),
  }
})

const mockComplete = vi.mocked(completeWorkCard)

// This jsdom build ships window.localStorage as a plain object - install a
// minimal in-memory Storage so saved views / the completed strip work.
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
    dueDate: '2026-08-20',
    assigneeId: 1,
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  }
}

const queue: UnifiedQueue = {
  today: '2026-08-23',
  buckets: {
    overdue: [card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Bank feed week of 2026-08-17' })],
    due_today: [card({ kind: 'task', id: 2, status: 'due_today', title: 'Close August books', dueDate: '2026-08-23' })],
    upcoming: [card({ kind: 'report', id: 3, status: 'upcoming', title: 'August management report', dueDate: '2026-08-31' })],
    waiting_on_client: [
      card({ kind: 'bank_feed', id: 4, status: 'waiting_on_client', title: 'Bank feed week of 2026-08-10', waitingOnClient: true }),
    ],
    deferred: [],
    gated: [card({ kind: 'reconciliation', id: 5, status: 'gated', title: 'Reconcile Checking' })],
  },
}

const assignees = [{ id: 1, name: 'Mara Ellison', initials: 'ME' }]

function renderQueue() {
  // AppShell provides TooltipProvider in production.
  return render(
    <TooltipProvider>
      <WorkstationQueue queue={queue} assignees={assignees} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  mockComplete.mockReset()
  mockComplete.mockResolvedValue({ ok: true })
})

describe('WorkstationQueue', () => {
  it('renders bucket tabs and stat chips with counts', () => {
    renderQueue()
    const overdueTab = screen.getByRole('tab', { name: /Overdue/ })
    expect(overdueTab).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Due Today/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Gated/ })).toHaveTextContent('1')
    // KPI chip: colored count + label
    const chip = screen.getByRole('button', { name: /Waiting on client/ })
    expect(chip).toHaveTextContent('1')
  })

  it('narrows the list when a bucket tab is selected', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByRole('tab', { name: /Due Today/ }))
    expect(screen.getByText('Close August books')).toBeInTheDocument()
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    expect(screen.queryByText('August management report')).not.toBeInTheDocument()
  })

  it('filters by search text across title and client', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.type(screen.getByLabelText('Search work items'), 'management')
    expect(screen.getByText('August management report')).toBeInTheDocument()
    expect(screen.queryByText('Close August books')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search work items'))
    await user.type(screen.getByLabelText('Search work items'), 'zzz')
    expect(screen.getByText('No work matches these filters.')).toBeInTheDocument()
  })

  it('moves the keyboard selection with j and k', async () => {
    const user = userEvent.setup()
    renderQueue()
    const rows = screen.getAllByTestId('work-card')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')

    await user.keyboard('j')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('k')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('completes the selected card with E, optimistically moving it to the strip', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.keyboard('e')

    expect(mockComplete).toHaveBeenCalledWith({ kind: 'bank_feed', id: 1 }, true)
    // Optimistic: out of the open list, into the completed strip.
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Completed - Bank feed week of 2026-08-17'),
    ).toBeInTheDocument()
  })

  it('rolls back and reports when the complete action fails', async () => {
    // Deferred action so the optimistic state is observable mid-flight.
    let settle!: (r: CompleteWorkCardResult) => void
    mockComplete.mockReturnValue(
      new Promise((res) => {
        settle = res
      }),
    )
    const user = userEvent.setup()
    renderQueue()
    await user.keyboard('e')

    // Optimistic removal while the action is in flight…
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    // …then rollback once the rejection lands.
    settle({ ok: false, error: 'Upload the report document first.' })
    await waitFor(() =>
      expect(screen.getByText('Bank feed week of 2026-08-17')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Completed - Bank feed week of 2026-08-17')).not.toBeInTheDocument()
  })

  it('re-opens the last completed card with X', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.keyboard('e')
    expect(await screen.findByText('Completed - Bank feed week of 2026-08-17')).toBeInTheDocument()

    await user.keyboard('x')
    expect(mockComplete).toHaveBeenLastCalledWith({ kind: 'bank_feed', id: 1 }, false)
    await waitFor(() =>
      expect(screen.getByText('Bank feed week of 2026-08-17')).toBeInTheDocument(),
    )
  })

  it('narrows by kind toggle', async () => {
    const user = userEvent.setup()
    renderQueue()
    // Turn off bank feeds: two bank-feed cards disappear, the rest stay.
    await user.click(screen.getByRole('button', { name: 'Bank feed' }))
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    expect(screen.queryByText('Bank feed week of 2026-08-10')).not.toBeInTheDocument()
    expect(screen.getByText('Close August books')).toBeInTheDocument()
  })

  it('saves a filter set as a named view and re-applies it', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.type(screen.getByLabelText('Search work items'), 'management')
    await user.click(screen.getByRole('button', { name: /Save view/ }))
    await user.type(screen.getByLabelText('Save current filters as a view'), 'Reports only')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const chip = await screen.findByRole('button', { name: 'Reports only' })
    // Clear, then re-apply from the chip.
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Close August books')).toBeInTheDocument()
    await user.click(chip)
    expect(screen.queryByText('Close August books')).not.toBeInTheDocument()
    expect(screen.getByText('August management report')).toBeInTheDocument()
  })
})
