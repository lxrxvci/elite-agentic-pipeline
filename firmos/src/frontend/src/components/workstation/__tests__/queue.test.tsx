import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyRolloverAction, completeWorkCard } from '@/server/actions/work'
import type { CompleteWorkCardResult } from '@/server/actions/work'
import { getClockStatusAction } from '@/server/actions/time'
import {
  getReportCardDetailAction,
  getTaskDetailAction,
  getWorkCardSopDetailAction,
} from '@/server/actions/tasks'
import type { UnifiedQueue, WorkCard } from '@/server/queue'
import type { ClockStatus } from '@/server/time-tracking'
import { __resetClockStatusForTests } from '@/shared/lib/clock-status'
import { TooltipProvider } from '@/components/ui/tooltip'

import { quickCelebrationRoll } from '../my-day'
import { WorkstationQueue } from '../queue'
import { WorkCardRow } from '../work-card'

vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn(),
  applyRolloverAction: vi.fn(),
}))

// The shared clock-status store dynamically imports this module; give it a
// quiet default so only the tests that set a status see timer chrome.
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn(),
}))

// The drawer opens from card clicks (report cards included since the action
// -surface wave); it dynamic-imports these modules - pin them so the drawer
// renders without a database.
vi.mock('@/server/actions/tasks', () => ({
  getTaskDetailAction: vi.fn(),
  getWorkCardSopDetailAction: vi.fn(),
  getReportCardDetailAction: vi.fn(),
  setSubtaskCompletedAction: vi.fn(),
  addTaskNoteAction: vi.fn(),
  assignTaskAction: vi.fn(),
}))
vi.mock('@/server/actions/documents', () => ({
  uploadReportDocumentAction: vi.fn(),
}))

const mockClockStatus = vi.mocked(getClockStatusAction)
const mockReportCardDetail = vi.mocked(getReportCardDetailAction)
const mockTaskDetail = vi.mocked(getTaskDetailAction)
const mockCardSopDetail = vi.mocked(getWorkCardSopDetailAction)

const EMPTY_CLOCK: ClockStatus = {
  clockedIn: true,
  dayStartedAt: new Date().toISOString(),
  dayElapsedMinutes: 30,
  currentActivity: null,
  openTaskTimers: [],
  lastActivityAt: null,
}

// The saved-views seam talks to /api/saved-views over fetch; stub a minimal
// in-memory REST surface so these tests stay focused on the queue.
const savedViewsStore: { id: number; name: string; context: string; filters: unknown; position: number }[] = []
let savedViewSeq = 0
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('/api/saved-views/') && init?.method === 'DELETE') {
    const name = decodeURIComponent(url.slice('/api/saved-views/'.length, url.indexOf('?')))
    const idx = savedViewsStore.findIndex((v) => v.name === name)
    if (idx >= 0) savedViewsStore.splice(idx, 1)
    return jsonResponse({ ok: true, data: { deleted: true } })
  }
  if (url.startsWith('/api/saved-views') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    if (Array.isArray(body.views)) return jsonResponse({ ok: true, data: { imported: 0 } })
    if (savedViewsStore.some((v) => v.name.toLowerCase() === String(body.name).toLowerCase())) {
      return jsonResponse({ ok: false, error: `A view named "${body.name}" already exists - pick another name.` })
    }
    savedViewSeq += 1
    const record = { id: savedViewSeq, name: body.name, context: body.context, filters: body.filters, position: savedViewSeq }
    savedViewsStore.push(record)
    return jsonResponse({ ok: true, data: record })
  }
  return jsonResponse({ ok: true, data: [...savedViewsStore] })
})
vi.stubGlobal('fetch', fetchStub)

const mockComplete = vi.mocked(completeWorkCard)
const mockRollover = vi.mocked(applyRolloverAction)

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
  bumperLanes: { enabled: false, activeClientId: null, activeClientName: null, activeStage: null },
  buckets: {
    overdue: [card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Bank feed week of 2026-08-17' })],
    due_today: [card({ kind: 'task', id: 2, status: 'due_today', title: 'Close August books', dueDate: '2026-08-23' })],
    upcoming: [
      card({ kind: 'report', id: 3, status: 'upcoming', title: 'August management report', dueDate: '2026-08-31', clientId: 2, clientName: 'Copperline Coffee' }),
    ],
    waiting_on_client: [
      card({ kind: 'bank_feed', id: 4, status: 'waiting_on_client', title: 'Bank feed week of 2026-08-10', waitingOnClient: true, clientId: 2, clientName: 'Copperline Coffee' }),
    ],
    deferred: [],
    gated: [
      card({ kind: 'reconciliation', id: 5, status: 'gated', title: 'Reconcile Checking', clientId: 2, clientName: 'Copperline Coffee' }),
    ],
  },
}

const assignees = [{ id: 1, name: 'Mara Ellison', initials: 'ME' }]

function renderQueue(q: UnifiedQueue = queue) {
  // AppShell provides TooltipProvider in production.
  return render(
    <TooltipProvider>
      <WorkstationQueue queue={q} assignees={assignees} />
    </TooltipProvider>,
  )
}

/** D1: the full queue lives one tab away - most legacy flows assert there. */
async function switchToAllWork(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('view-tab-queue'))
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  savedViewsStore.length = 0
  fetchStub.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  mockComplete.mockReset()
  mockComplete.mockResolvedValue({ ok: true })
  mockRollover.mockReset()
  mockRollover.mockResolvedValue({ ok: true, applied: 1, skipped: [] })
  __resetClockStatusForTests()
  mockClockStatus.mockReset()
  mockClockStatus.mockResolvedValue({ ok: true, data: EMPTY_CLOCK })
  // Drawer reads: error-shaped defaults (the drawer's quiet error state) -
  // tests that open a drawer install their own payload.
  mockTaskDetail.mockReset()
  mockTaskDetail.mockResolvedValue({ ok: false, error: 'Not loaded in this test.' })
  mockCardSopDetail.mockReset()
  mockCardSopDetail.mockResolvedValue({ ok: false, error: 'Not loaded in this test.' })
  mockReportCardDetail.mockReset()
  mockReportCardDetail.mockResolvedValue({
    ok: true,
    data: {
      kind: 'report',
      id: 3,
      title: 'August management report',
      clientId: 2,
      clientName: 'Copperline Coffee',
      dueDate: '2026-08-31',
      attributedYear: 2026,
      attributedMonth: 8,
      completedAt: null,
      documentFileName: null,
      today: '2026-08-23',
    },
  })
})

describe('WorkstationQueue - My Day default (D1)', () => {
  it('lands on My Day: actionable cards grouped by client, nothing ambient', () => {
    renderQueue()
    expect(screen.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')
    // Actionable now: overdue + due_today, in one per-client group card.
    expect(screen.getByText('Bank feed week of 2026-08-17')).toBeInTheDocument()
    expect(screen.getByText('Close August books')).toBeInTheDocument()
    const group = screen.getByTestId('my-day-client')
    expect(group).toHaveTextContent('Harborline Marine')
    expect(group).toHaveTextContent('2 left')
    // Never in My Day: upcoming backlog, waiting, gated.
    expect(screen.queryByText('August management report')).not.toBeInTheDocument()
    expect(screen.queryByText('Bank feed week of 2026-08-10')).not.toBeInTheDocument()
    expect(screen.queryByText('Reconcile Checking')).not.toBeInTheDocument()
    // The D2 entry point is offered.
    expect(screen.getByTestId('start-my-day')).toBeInTheDocument()
  })

  it('scopes the hero stats to My Day and never shows ambient red upcoming', () => {
    renderQueue()
    expect(screen.getByTestId('stat-overdue')).toHaveTextContent('1')
    expect(screen.getByTestId('stat-due_today')).toHaveTextContent('1')
    expect(screen.getByTestId('stat-done')).toHaveTextContent('0')
    expect(screen.getByTestId('stat-waiting_on_client')).toHaveTextContent('1')
    // No Upcoming hero in the default scope at all.
    expect(screen.queryByTestId('stat-upcoming')).not.toBeInTheDocument()
  })

  it('labels the day pills by when they unlock, with actionable counts', () => {
    renderQueue()
    // Today (Sunday 2026-08-23) defaults to All; the pills carry per-day
    // actionable counts - never the raw 5-card backlog.
    expect(screen.getByTestId('work-day-chip-all')).toHaveTextContent('2')
  })

  it('the stat chips sub-filter the My Day set', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('stat-overdue'))
    expect(screen.getByText('Bank feed week of 2026-08-17')).toBeInTheDocument()
    expect(screen.queryByText('Close August books')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('stat-overdue'))
    expect(screen.getByText('Close August books')).toBeInTheDocument()
  })

  it('All work restores the full queue with bucket tabs', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
    expect(screen.getByRole('tab', { name: /Overdue/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('work-card')).toHaveLength(5)
    expect(screen.getByText('August management report')).toBeInTheDocument()
    expect(screen.getByText('Reconcile Checking')).toBeInTheDocument()
  })

  it('Clock-C1: the group header dots the client that is on the clock', async () => {
    // Two actionable clients; the timer runs on Harborline (clientId 1).
    const twoClients: UnifiedQueue = {
      ...queue,
      buckets: {
        ...queue.buckets,
        overdue: [card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Bank feed week of 2026-08-17' })],
        due_today: [
          card({ kind: 'task', id: 2, status: 'due_today', title: 'Close August books', dueDate: '2026-08-23' }),
          card({ kind: 'task', id: 6, status: 'due_today', title: 'Copperline close', dueDate: '2026-08-23', clientId: 2, clientName: 'Copperline Coffee' }),
        ],
      },
    }
    mockClockStatus.mockResolvedValue({
      ok: true,
      data: {
        ...EMPTY_CLOCK,
        currentActivity: {
          entryId: 9,
          activityType: 'bank_feeds',
          clientId: 1,
          clientName: 'Harborline Marine',
          referenceType: 'bank_feed',
          referenceId: 1,
          startedAt: new Date().toISOString(),
          elapsedMinutes: 3,
        },
      },
    })
    renderQueue(twoClients)

    const groups = await screen.findAllByTestId('my-day-client')
    expect(groups).toHaveLength(2)
    await waitFor(() => {
      const harborline = groups.find((g) => g.textContent?.includes('Harborline Marine'))!
      expect(within(harborline).getByTestId('my-day-on-clock-dot')).toBeInTheDocument()
    })
    const copperline = groups.find((g) => g.textContent?.includes('Copperline Coffee'))!
    expect(within(copperline).queryByTestId('my-day-on-clock-dot')).not.toBeInTheDocument()
  })

  it('Clock-C1: a running break dots no client group', async () => {
    mockClockStatus.mockResolvedValue({
      ok: true,
      data: {
        ...EMPTY_CLOCK,
        currentActivity: {
          entryId: 9,
          activityType: 'lunch_unpaid',
          clientId: null,
          clientName: null,
          referenceType: null,
          referenceId: null,
          startedAt: new Date().toISOString(),
          elapsedMinutes: 3,
        },
      },
    })
    renderQueue()
    await screen.findAllByTestId('my-day-client')
    // Let the store's status land before asserting absence.
    await waitFor(() => expect(mockClockStatus).toHaveBeenCalled())
    expect(screen.queryByTestId('my-day-on-clock-dot')).not.toBeInTheDocument()
  })
})

describe('WorkstationQueue - full queue', () => {
  it('renders bucket tabs and stat chips with counts', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
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
    await switchToAllWork(user)
    await user.click(screen.getByRole('tab', { name: /Due Today/ }))
    expect(screen.getByText('Close August books')).toBeInTheDocument()
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    expect(screen.queryByText('August management report')).not.toBeInTheDocument()
  })

  it('filters by search text across title and client', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
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
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(rows[1]).not.toHaveAttribute('aria-current')

    await user.keyboard('j')
    expect(rows[0]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')

    await user.keyboard('k')
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
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
    await switchToAllWork(user)
    // Turn off bank feeds: two bank-feed cards disappear, the rest stay.
    await user.click(screen.getByRole('button', { name: 'Bank feed' }))
    expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument()
    expect(screen.queryByText('Bank feed week of 2026-08-10')).not.toBeInTheDocument()
    expect(screen.getByText('Close August books')).toBeInTheDocument()
  })

  it('saves a filter set as a named view and re-applies it', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
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

describe('Focus mode (auto-prioritizer)', () => {
  it('collapses the queue to a single card and advances with Skip', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
    await user.click(screen.getByTestId('focus-toggle'))

    const focus = screen.getByTestId('focus-mode')
    expect(focus).toHaveTextContent('Card 1 of 5')
    const rows = within(focus).getAllByTestId('work-card')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-card-title', 'Bank feed week of 2026-08-17')

    await user.click(screen.getByTestId('focus-skip'))
    expect(focus).toHaveTextContent('Card 2 of 5')
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Close August books',
    )

    // Toggling off restores the full queue.
    await user.click(screen.getByTestId('focus-toggle'))
    expect(screen.queryByTestId('focus-mode')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('work-card')).toHaveLength(5)
  })

  it('completes the focused card with Next and keeps the undo strip', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('focus-toggle'))
    await user.click(screen.getByTestId('focus-next'))

    expect(mockComplete).toHaveBeenCalledWith({ kind: 'bank_feed', id: 1 }, true)
    const focus = screen.getByTestId('focus-mode')
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Close August books',
    )
    expect(
      await screen.findByText('Completed - Bank feed week of 2026-08-17'),
    ).toBeInTheDocument()
  })

  it('remembers the mode in sessionStorage', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('focus-toggle'))
    await waitFor(() =>
      expect(window.sessionStorage.getItem('firmos.workstation.focus')).toBe('1'),
    )
  })

  it('keeps j/k/E working while focused', async () => {
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
    await user.click(screen.getByTestId('focus-toggle'))
    await user.keyboard('j')
    expect(screen.getByTestId('focus-mode')).toHaveTextContent('Card 2 of 5')
    await user.keyboard('e')
    expect(mockComplete).toHaveBeenCalledWith({ kind: 'task', id: 2 }, true)
  })
})

describe('Up Next lane (D2)', () => {
  it('Start my day enters a frozen one-card sequence in hierarchy order', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('start-my-day'))

    const focus = screen.getByTestId('focus-mode')
    expect(focus).toHaveTextContent('Up Next')
    expect(focus).toHaveTextContent('Card 1 of 2')
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Bank feed week of 2026-08-17',
    )

    // Complete: the frozen sequence advances, no reshuffle.
    await user.click(screen.getByTestId('focus-next'))
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Close August books',
    )

    // Exit returns to My Day.
    await user.click(screen.getByTestId('up-next-exit'))
    expect(screen.queryByTestId('focus-mode')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-tab-my-day')).toHaveAttribute('aria-selected', 'true')
  })

  it('orders by bumper lane when lanes are on: active client first, stage order inside', async () => {
    const laneQueue: UnifiedQueue = {
      today: '2026-08-23',
      bumperLanes: {
        enabled: true,
        activeClientId: 2,
        activeClientName: 'Zebra Outfitters',
        activeStage: 'tasks',
      },
      buckets: {
        overdue: [],
        due_today: [
          // Hierarchy order (kind class first) would serve the Alpha feed;
          // the lane serves the client whose work is due earliest - Zebra.
          card({
            kind: 'task',
            id: 11,
            status: 'due_today',
            title: 'Zebra ad-hoc task',
            clientId: 2,
            clientName: 'Zebra Outfitters',
            dueDate: '2026-08-23',
            orderClass: 'ad_hoc',
          }),
          card({
            kind: 'bank_feed',
            id: 12,
            status: 'due_today',
            title: 'Alpha feed',
            clientId: 3,
            clientName: 'Alpha Bakery',
            dueDate: '2026-08-24',
            orderClass: 'periodic',
          }),
        ],
        upcoming: [],
        waiting_on_client: [],
        deferred: [],
        gated: [],
      },
    }
    const user = userEvent.setup()
    renderQueue(laneQueue)
    await user.click(screen.getByTestId('start-my-day'))

    const focus = screen.getByTestId('focus-mode')
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Zebra ad-hoc task',
    )
    await user.click(screen.getByTestId('focus-skip'))
    expect(within(focus).getByTestId('work-card')).toHaveAttribute(
      'data-card-title',
      'Alpha feed',
    )
  })
})

describe('Guided rollover (D3)', () => {
  const rolloverQueue: UnifiedQueue = {
    today: '2026-08-23',
    bumperLanes: { enabled: false, activeClientId: null, activeClientName: null, activeStage: null },
    buckets: {
      overdue: [
        card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Bank feed week of 2026-08-17', assigneeId: 1 }),
        card({ kind: 'task', id: 2, status: 'overdue', title: 'Call about payroll', assigneeId: 2 }),
      ],
      due_today: [],
      upcoming: [],
      waiting_on_client: [],
      deferred: [],
      gated: [],
    },
  }

  it('opens on the first visit of the day for assigned-to-me overdue items', async () => {
    render(
      <TooltipProvider>
        <WorkstationQueue queue={rolloverQueue} assignees={assignees} currentUserId={1} />
      </TooltipProvider>,
    )
    const dialog = await screen.findByTestId('rollover-dialog')
    // Only MY overdue item is listed - the other user's task stays out.
    expect(dialog).toHaveTextContent('Bank feed week of 2026-08-17')
    expect(dialog).toHaveTextContent('1 item from before today')
    expect(dialog).not.toHaveTextContent('Call about payroll')
    // The fast path: one tap keeps everything for today.
    await userEvent.click(screen.getByTestId('rollover-apply'))
    expect(mockRollover).toHaveBeenCalledWith([{ kind: 'bank_feed', id: 1, action: 'today' }])
    await waitFor(() =>
      expect(screen.queryByTestId('rollover-dialog')).not.toBeInTheDocument(),
    )
  })

  it('does not reopen once seen today; the subtle cue re-enters', async () => {
    window.localStorage.setItem('firmos.workstation.rollover:1', '2026-08-23')
    render(
      <TooltipProvider>
        <WorkstationQueue queue={rolloverQueue} assignees={assignees} currentUserId={1} />
      </TooltipProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('rollover-cue')).toBeInTheDocument())
    expect(screen.queryByTestId('rollover-dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('rollover-cue'))
    expect(await screen.findByTestId('rollover-dialog')).toBeInTheDocument()
    // Later dismisses without applying.
    await userEvent.click(screen.getByTestId('rollover-later'))
    expect(mockRollover).not.toHaveBeenCalled()
  })

  it('per-kind support: feeds offer defer+waiting, tasks offer waiting only', async () => {
    const mixed: UnifiedQueue = {
      ...rolloverQueue,
      buckets: {
        ...rolloverQueue.buckets,
        overdue: [
          card({ kind: 'bank_feed', id: 1, status: 'overdue', title: 'Feed overdue', assigneeId: 1 }),
          card({ kind: 'task', id: 3, status: 'overdue', title: 'Task overdue', assigneeId: 1 }),
          card({ kind: 'report', id: 4, status: 'overdue', title: 'Report overdue', assigneeId: 1 }),
        ],
      },
    }
    render(
      <TooltipProvider>
        <WorkstationQueue queue={mixed} assignees={assignees} currentUserId={1} />
      </TooltipProvider>,
    )
    const dialog = await screen.findByTestId('rollover-dialog')
    const rows = within(dialog).getAllByTestId('rollover-item')
    const choicesOf = (row: HTMLElement) =>
      within(row)
        .getAllByRole('button')
        .map((b) => b.textContent)
    expect(choicesOf(rows[0])).toEqual(['Today', 'Defer…', 'Waiting'])
    expect(choicesOf(rows[1])).toEqual(['Today', 'Waiting'])
    expect(choicesOf(rows[2])).toEqual(['Today'])
  })
})

describe('Header green action + caught-up state', () => {
  it('completes the selected card with the header Complete next button', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.click(screen.getByTestId('complete-next'))
    expect(mockComplete).toHaveBeenCalledWith({ kind: 'bank_feed', id: 1 }, true)
  })

  it('renders the celebratory caught-up state when the queue is empty', () => {
    const empty: UnifiedQueue = {
      today: '2026-08-23',
      bumperLanes: { enabled: false, activeClientId: null, activeClientName: null, activeStage: null },
      buckets: {
        overdue: [],
        due_today: [],
        upcoming: [],
        waiting_on_client: [],
        deferred: [],
        gated: [],
      },
    }
    render(
      <TooltipProvider>
        <WorkstationQueue queue={empty} assignees={assignees} />
      </TooltipProvider>,
    )
    const caughtUp = screen.getByTestId('caught-up')
    expect(caughtUp).toHaveTextContent('All caught up')
    // The celebration reuses CheckDraw - reduced-motion safe by construction.
    expect(within(caughtUp).getByTestId('check-draw')).toBeInTheDocument()
    expect(screen.getByTestId('complete-next')).toBeDisabled()
  })
})

describe('Variable-ratio celebration (D4)', () => {
  it('the strip draws CheckDraw only for entries whose seeded roll earns it', async () => {
    const user = userEvent.setup()
    renderQueue()
    await user.keyboard('e')

    const strip = await screen.findByTestId('completed-strip')
    const earned = quickCelebrationRoll(null, '2026-08-23', 'bank_feed:1')
    if (earned) {
      expect(within(strip).getByTestId('check-draw')).toBeInTheDocument()
    } else {
      expect(within(strip).queryByTestId('check-draw')).not.toBeInTheDocument()
    }
    // Either way the strip row itself renders (the undo contract is unchanged).
    expect(strip).toHaveTextContent('Completed - Bank feed week of 2026-08-17')
  })

  it('the seeded roll is deterministic per user per day per card', () => {
    const a = quickCelebrationRoll(7, '2026-08-23', 'task:11')
    const b = quickCelebrationRoll(7, '2026-08-23', 'task:11')
    expect(a).toBe(b)
    // Rough rate sanity over a spread of keys: ~35%, not 0% or 100%.
    let hits = 0
    for (let i = 0; i < 200; i++) {
      if (quickCelebrationRoll(7, '2026-08-23', `task:${i}`)) hits += 1
    }
    expect(hits).toBeGreaterThan(30)
    expect(hits).toBeLessThan(110)
  })

  it('fires the rare big celebration when a client’s last open item completes', async () => {
    const user = userEvent.setup()
    // Two cards for Harborline: completing both closes the client's week.
    renderQueue()
    await user.keyboard('e') // bank_feed:1 (one remains for the client)
    await waitFor(() =>
      expect(screen.queryByText('Bank feed week of 2026-08-17')).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId('celebration-burst')).not.toBeInTheDocument()

    await user.keyboard('e') // task:2 - the client's last open item
    const burst = await screen.findByTestId('celebration-burst')
    expect(burst).toHaveTextContent("Harborline Marine's week is closed")
  })

  it('fires the big celebration for rescuing a 30+ day stale item', async () => {
    const staleQueue: UnifiedQueue = {
      today: '2026-08-23',
      bumperLanes: { enabled: false, activeClientId: null, activeClientName: null, activeStage: null },
      buckets: {
        overdue: [
          card({
            kind: 'task',
            id: 8,
            status: 'overdue',
            title: 'Ancient cleanup',
            dueDate: '2026-06-01',
            clientId: 9,
            clientName: 'Copperline Coffee',
          }),
        ],
        due_today: [],
        upcoming: [
          // Another open item for the same client: NOT a week-close, but the
          // 83-day stale rescue still earns the rare moment.
          card({
            kind: 'task',
            id: 9,
            status: 'upcoming',
            title: 'Future thing',
            dueDate: '2026-09-01',
            clientId: 9,
            clientName: 'Copperline Coffee',
          }),
        ],
        waiting_on_client: [],
        deferred: [],
        gated: [],
      },
    }
    const user = userEvent.setup()
    renderQueue(staleQueue)
    await user.keyboard('e')
    const burst = await screen.findByTestId('celebration-burst')
    expect(burst).toHaveTextContent('Nice recovery')
    expect(burst).toHaveTextContent('83 days overdue')
  })

  it('the admin flag quiets the big celebration firm-wide', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <WorkstationQueue queue={queue} assignees={assignees} celebrationsEnabled={false} />
      </TooltipProvider>,
    )
    await user.keyboard('e')
    await user.keyboard('e')
    await waitFor(() =>
      expect(screen.queryByText('Close August books')).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId('celebration-burst')).not.toBeInTheDocument()
  })
})

describe('Completion check-draw (Wave 3 dopamine hit)', () => {
  it('swaps the work-card complete button to the drawing check on click', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(
      <TooltipProvider>
        <WorkCardRow
          card={card({ kind: 'task', id: 9, status: 'due_today', title: 'Categorize Transactions' })}
          today="2026-08-23"
          selected
          onSelect={() => {}}
          onComplete={onComplete}
        />
      </TooltipProvider>,
    )
    const button = screen.getByRole('button', { name: 'Complete: Categorize Transactions' })
    expect(within(button).queryByTestId('check-draw')).not.toBeInTheDocument()
    await user.click(button)
    expect(onComplete).toHaveBeenCalled()
    expect(within(button).getByTestId('check-draw')).toBeInTheDocument()
  })
})

describe('WorkstationQueue - correspondence badge', () => {
  it('shows the unread-reply chip on the My Day client card, linked to the tab', () => {
    render(
      <TooltipProvider>
        <WorkstationQueue queue={queue} assignees={assignees} unreadByClient={{ 1: 2 }} />
      </TooltipProvider>,
    )
    const group = screen.getByTestId('my-day-client')
    const badge = within(group).getByTestId('my-day-correspondence-badge')
    expect(badge).toHaveTextContent('2')
    expect(badge.closest('a')).toHaveAttribute('href', '/clients/1?tab=correspondence')
  })

  it('no chip when the client has no unread replies', () => {
    renderQueue()
    const group = screen.getByTestId('my-day-client')
    expect(within(group).queryByTestId('my-day-correspondence-badge')).not.toBeInTheDocument()
  })
})

describe('I5 institution SOP count badge (learning center)', () => {
  function renderRow(cardOverrides: Parameters<typeof card>[0]) {
    return render(
      <TooltipProvider>
        <WorkCardRow
          card={card(cardOverrides)}
          today="2026-08-23"
          selected
          onSelect={() => {}}
          onComplete={() => {}}
        />
      </TooltipProvider>,
    )
  }

  it('bank-feed and reconciliation cards with matched SOPs show the icon + count', () => {
    renderRow({ kind: 'bank_feed', id: 21, status: 'due_today', sopCount: 2 })
    const badge = screen.getByTestId('card-sop-count')
    expect(badge).toHaveTextContent('2')
    expect(badge).toHaveAttribute('aria-label', '2 bank SOPs')
  })

  it('singular label for exactly one SOP', () => {
    renderRow({ kind: 'reconciliation', id: 22, status: 'due_today', sopCount: 1 })
    expect(screen.getByTestId('card-sop-count')).toHaveAttribute('aria-label', '1 bank SOP')
  })

  it('stays quiet at zero - the bank has no SOPs yet (no badge)', () => {
    renderRow({ kind: 'reconciliation', id: 23, status: 'due_today', sopCount: 0 })
    expect(screen.queryByTestId('card-sop-count')).not.toBeInTheDocument()
  })

  it('task cards never carry the badge (their SOPs live in the task drawer)', () => {
    renderRow({ kind: 'task', id: 24, status: 'due_today', sopCount: 3 })
    expect(screen.queryByTestId('card-sop-count')).not.toBeInTheDocument()
  })
})

describe('Drawer opening per kind (01:39:05: every card opens its DO surface)', () => {
  it('clicking a report card opens the drawer with the report upload surface', async () => {
    // Radix primitives call pointer-capture APIs jsdom does not implement.
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false
      Element.prototype.setPointerCapture = () => {}
      Element.prototype.releasePointerCapture = () => {}
    }
    const user = userEvent.setup()
    renderQueue()
    await switchToAllWork(user)
    // Report cards used to be click-to-select only; now the drawer IS the
    // place you finish the report.
    await user.click(screen.getByText('August management report'))
    const drawer = await screen.findByTestId('task-drawer')
    expect(mockReportCardDetail).toHaveBeenCalledWith(3)
    expect(await within(drawer).findByTestId('task-drawer-title')).toHaveTextContent(
      'August management report',
    )
    expect(within(drawer).getByTestId('report-upload-dropzone')).toBeInTheDocument()
    expect(within(drawer).getByTestId('reports-surface-link')).toHaveAttribute(
      'href',
      '/clients/2?tab=reports&year=2026&month=8',
    )
  })
})
