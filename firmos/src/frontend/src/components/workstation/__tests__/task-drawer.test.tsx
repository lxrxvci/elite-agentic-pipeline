import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addTaskNoteAction, assignTaskAction, getTaskDetailAction, getWorkCardSopDetailAction, setSubtaskCompletedAction } from '@/server/actions/tasks'
import { getCloseStepsAction } from '@/server/actions/close-steps'
import type { TaskDetail, WorkCardSopDetail } from '@/server/task-detail'
import type { CloseSteps } from '@/server/year-grid'

import { TaskDrawer } from '../task-drawer'

// Radix primitives call pointer-capture APIs jsdom does not implement.
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  Element.prototype.scrollIntoView = vi.fn()
})

vi.mock('@/server/actions/tasks', () => ({
  getTaskDetailAction: vi.fn(),
  getWorkCardSopDetailAction: vi.fn(),
  setSubtaskCompletedAction: vi.fn(),
  addTaskNoteAction: vi.fn(),
  assignTaskAction: vi.fn(),
}))

// The SOP staleness flag dynamic-imports the templates action module.
vi.mock('@/server/actions/templates', () => ({
  flagSopStaleAction: vi.fn(),
}))

// The month-close context strip dynamic-imports this action.
vi.mock('@/server/actions/close-steps', () => ({
  getCloseStepsAction: vi.fn(),
}))

// The drawer reuses the card's timer toggle, which dynamic-imports these.
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn().mockResolvedValue({ ok: true, data: { openTaskTimers: [] } }),
  startTaskTimerAction: vi.fn(),
  stopTaskTimerAction: vi.fn(),
}))

import { flagSopStaleAction } from '@/server/actions/templates'

const mockDetail = vi.mocked(getTaskDetailAction)
const mockCardDetail = vi.mocked(getWorkCardSopDetailAction)
const mockToggle = vi.mocked(setSubtaskCompletedAction)
const mockAddNote = vi.mocked(addTaskNoteAction)
const mockAssign = vi.mocked(assignTaskAction)
const mockFlagStale = vi.mocked(flagSopStaleAction)

const TASK_CARD = { kind: 'task' as const, id: 42 }

function detail(partial?: Partial<TaskDetail>): TaskDetail {
  return {
    task: {
      id: 42,
      title: 'Reconcile August',
      description: 'Close the fuel card first.',
      status: 'in_progress',
      taskType: 'recurring',
      dueDate: '2026-08-10',
      attributedYear: 2026,
      attributedMonth: 8,
      clientId: 1,
      clientName: 'Harborline Marine Supply',
      assigneeId: 3,
      assigneeName: 'Jorge Medina',
      completedAt: null,
    },
    subtasks: [
      { id: 11, title: 'Pull the statement', isCompleted: true, position: 0 },
      { id: 12, title: 'Match cleared items', isCompleted: false, position: 1 },
    ],
    notes: [
      {
        id: 21,
        body: 'Client sent the statement late.',
        authorName: 'Theo Park',
        createdAt: '2026-08-09T15:00:00.000Z',
      },
    ],
    sops: [
      {
        id: 31,
        title: 'Chevron WEX fuel card close',
        content: '1. Download the WEX statement\n2. Code fuel by vehicle\nhttps://www.loom.com/share/abc123',
        updatedAt: '2026-08-01T12:00:00.000Z',
        changeNote: 'Added the walkthrough video.',
        institutionKey: 'chevron wex',
        institutionName: 'Chevron WEX',
        links: ['https://www.loom.com/share/abc123'],
      },
    ],
    manualEntries: [
      { id: 41, title: 'Harborline-only quirk', content: 'They round cash deposits.', updatedAt: '2026-07-15T12:00:00.000Z' },
    ],
    assignableStaff: [
      { id: 3, name: 'Jorge Medina', openCount: 12 },
      { id: 6, name: 'Sofia Lindqvist', openCount: 4 },
    ],
    canFlagStale: true,
    today: '2026-08-15',
    ...partial,
  }
}

/** I5: the lighter learning-center payload for feed / reconciliation cards. */
function cardDetail(partial?: Partial<WorkCardSopDetail>): WorkCardSopDetail {
  return {
    kind: 'bank_feed',
    id: 7,
    title: 'Bank feed week of 2026-08-10',
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    dueDate: '2026-08-14',
    attributedYear: 2026,
    attributedMonth: 8,
    institutionNames: ['Columbia Bank'],
    hasInstitution: true,
    sops: [
      {
        id: 32,
        title: 'Columbia Bank statement pull',
        content: '1. Log in to the Columbia portal\n2. Download the statement PDF',
        updatedAt: '2026-08-05T12:00:00.000Z',
        changeNote: 'Portal moved the download button.',
        institutionKey: 'columbia bank',
        institutionName: 'Columbia Bank',
        links: [],
      },
    ],
    canFlagStale: true,
    today: '2026-08-15',
    ...partial,
  }
}

function renderDrawer(onToggleComplete = vi.fn()) {
  render(
    <TaskDrawer card={TASK_CARD} open={true} onOpenChange={() => {}} onToggleComplete={onToggleComplete} />,
  )
  return onToggleComplete
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDetail.mockResolvedValue({ ok: true, data: detail() })
  mockCardDetail.mockResolvedValue({ ok: true, data: cardDetail() })
  mockToggle.mockResolvedValue({ ok: true, data: { subtaskId: 12, isCompleted: true } })
  mockAddNote.mockResolvedValue({ ok: true, data: { noteId: 99 } })
  mockAssign.mockResolvedValue({ ok: true, data: { assigneeId: 6 } })
  mockFlagStale.mockResolvedValue({ ok: true, data: {} as never })
})

describe('TaskDrawer', () => {
  it('renders the header, checklist, SOP, and notes sections', async () => {
    renderDrawer()
    expect(await screen.findByTestId('task-drawer-title')).toHaveTextContent('Reconcile August')
    expect(screen.getByText('Harborline Marine Supply')).toBeInTheDocument()
    // Status badge, period chip, and due aging all visible.
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('5d overdue')).toBeInTheDocument()
    // Name appears in the sr-only avatar label and the visible caption.
    expect(screen.getAllByText('Jorge Medina').length).toBeGreaterThan(0)
    expect(screen.getByText('Close the fuel card first.')).toBeInTheDocument()
    // Checklist progress.
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // Notes thread.
    expect(screen.getByText('Client sent the statement late.')).toBeInTheDocument()
    expect(screen.getByText(/Theo Park · /)).toBeInTheDocument()
  })

  it('renders the SOP card with the staleness failsafe and a new-tab Loom link', async () => {
    renderDrawer()
    const card = (await screen.findByTestId('sop-card'))
    expect(card).toHaveTextContent('Chevron WEX fuel card close')
    expect(screen.getByTestId('sop-updated')).toHaveTextContent('Updated Aug 1, 2026 - Added the walkthrough video.')
    // The institution chip is marked as a bank SOP with the pretty name.
    expect(screen.getByTestId('sop-institution-chip')).toHaveTextContent('Chevron WEX SOP')
    // Steps render as a numbered list, URL stripped from the step text.
    expect(card).toHaveTextContent('Download the WEX statement')
    expect(card).not.toHaveTextContent('https://www.loom.com/share/abc123')
    const link = screen.getByTestId('sop-link')
    expect(link).toHaveAttribute('href', 'https://www.loom.com/share/abc123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // Standalone client manual entries render under their own heading.
    expect(screen.getByTestId('manual-entry')).toHaveTextContent('Harborline-only quirk')
  })

  it('flags a SOP stale from the drawer when the caller is manager+', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const flag = await screen.findByTestId('sop-flag-stale')
    await user.click(flag)
    expect(mockFlagStale).toHaveBeenCalledWith(31)
    // The drawer refreshes from the server answer so the marker shows.
    await waitFor(() => expect(mockDetail).toHaveBeenCalledTimes(2))
  })

  it('hides the flag-stale action from bookkeepers', async () => {
    mockDetail.mockResolvedValue({ ok: true, data: detail({ canFlagStale: false }) })
    renderDrawer()
    await screen.findByTestId('sop-card')
    expect(screen.queryByTestId('sop-flag-stale')).not.toBeInTheDocument()
  })

  it('toggles a subtask optimistically and calls the action', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const checkbox = await screen.findByRole('checkbox', { name: 'Match cleared items' })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(mockToggle).toHaveBeenCalledWith(12, true)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Match cleared items' })).toBeChecked())
  })

  it('adds a note and clears the draft', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const box = await screen.findByLabelText('Add a note')
    await user.type(box, 'Statement arrived today.')
    await user.click(screen.getByRole('button', { name: /add note/i }))
    expect(mockAddNote).toHaveBeenCalledWith(42, 'Statement arrived today.')
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('assigns inline with each candidate’s open-work count (E13)', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await screen.findByTestId('task-drawer-title')

    await user.click(screen.getByTestId('task-assign-select'))
    // Every candidate option carries the current load.
    expect(await screen.findByRole('option', { name: 'Sofia Lindqvist (4 open)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jorge Medina (12 open)' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Sofia Lindqvist (4 open)' }))
    expect(mockAssign).toHaveBeenCalledWith(42, 6)
  })

  it('delegates completion to the queue handler once the checklist is done (B4)', async () => {
    const user = userEvent.setup()
    const onToggleComplete = renderDrawer()
    // B4 gate: with an open checklist item the complete action is disabled...
    const button = await screen.findByTestId('drawer-complete-toggle')
    expect(button).toHaveTextContent('Complete task')
    expect(button).toBeDisabled()
    expect(screen.getByTestId('subtask-gate-note')).toHaveTextContent('1 checklist item still open')
    // ...until the last subtask completes (optimistic local flip ungates it).
    await user.click(await screen.findByRole('checkbox', { name: 'Match cleared items' }))
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(onToggleComplete).toHaveBeenCalledWith(true)
  })

  it('shows the re-open arm for a completed task', async () => {
    mockDetail.mockResolvedValue({
      ok: true,
      data: detail({ task: { ...detail().task, status: 'completed', completedAt: '2026-08-12T18:00:00.000Z' } }),
    })
    renderDrawer()
    const button = await screen.findByTestId('drawer-complete-toggle')
    expect(button).toHaveTextContent('Re-open task')
  })
})

describe('TaskDrawer bank-feed / reconciliation cards (I5 learning center)', () => {
  const FEED_CARD = { kind: 'bank_feed' as const, id: 7 }

  function renderCardDrawer(
    card: { kind: 'bank_feed' | 'reconciliation'; id: number } = FEED_CARD,
    onToggleComplete = vi.fn(),
  ) {
    render(
      <TaskDrawer card={card} open={true} onOpenChange={() => {}} onToggleComplete={onToggleComplete} />,
    )
    return onToggleComplete
  }

  it('resolves the card institution SOPs - no checklist, notes, or timer', async () => {
    renderCardDrawer()
    expect(await screen.findByTestId('task-drawer-title')).toHaveTextContent(
      'Bank feed week of 2026-08-10',
    )
    expect(mockCardDetail).toHaveBeenCalledWith('bank_feed', 7)
    expect(mockDetail).not.toHaveBeenCalled()
    // Section is named for the bank; the SOP card is marked "Columbia Bank SOP".
    expect(screen.getByText('Columbia Bank SOPs')).toBeInTheDocument()
    expect(screen.getByTestId('sop-institution-chip')).toHaveTextContent('Columbia Bank SOP')
    expect(screen.getByTestId('sop-updated')).toHaveTextContent(
      'Updated Aug 5, 2026 - Portal moved the download button.',
    )
    expect(screen.getByText('Log in to the Columbia portal')).toBeInTheDocument()
    // The lighter mode: no task-only sections.
    expect(screen.queryByText('Checklist')).not.toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-timer-toggle')).not.toBeInTheDocument()
  })

  it('supports the reconciliation card kind too', async () => {
    mockCardDetail.mockResolvedValue({
      ok: true,
      data: cardDetail({ kind: 'reconciliation', id: 9, title: 'Reconcile Operating Checking' }),
    })
    renderCardDrawer({ kind: 'reconciliation', id: 9 })
    expect(await screen.findByTestId('task-drawer-title')).toHaveTextContent('Reconcile Operating Checking')
    expect(mockCardDetail).toHaveBeenCalledWith('reconciliation', 9)
    expect(screen.getByText('Aug 2026')).toBeInTheDocument()
  })

  it('flags an institution SOP stale and refreshes the card read', async () => {
    const user = userEvent.setup()
    renderCardDrawer()
    await user.click(await screen.findByTestId('sop-flag-stale'))
    expect(mockFlagStale).toHaveBeenCalledWith(32)
    await waitFor(() => expect(mockCardDetail).toHaveBeenCalledTimes(2))
  })

  it('quiet empty state: a bank with no SOPs yet names the gap', async () => {
    mockCardDetail.mockResolvedValue({
      ok: true,
      data: cardDetail({
        sops: [],
        institutionNames: ['First Interstate Bank'],
        hasInstitution: true,
      }),
    })
    renderCardDrawer()
    expect(await screen.findByTestId('sop-empty')).toHaveTextContent(
      'No SOPs yet for First Interstate Bank',
    )
    expect(screen.queryByTestId('sop-card')).not.toBeInTheDocument()
  })

  it('quiet empty state: no bank on the account yet', async () => {
    mockCardDetail.mockResolvedValue({
      ok: true,
      data: cardDetail({ sops: [], institutionNames: [], hasInstitution: false }),
    })
    renderCardDrawer()
    expect(await screen.findByTestId('sop-empty')).toHaveTextContent('No bank on this account yet')
  })

  it('names only the covered banks in the heading when the client spans several', async () => {
    // A feed card can span banks with and without SOPs: the heading leads
    // with the covered bank, not the full union.
    mockCardDetail.mockResolvedValue({
      ok: true,
      data: cardDetail({
        institutionNames: ['Columbia Bank', 'KeyBank'],
        sops: [
          {
            id: 33,
            title: 'Columbia Bank statement pull',
            content: null,
            updatedAt: '2026-08-05T12:00:00.000Z',
            changeNote: null,
            institutionKey: 'columbia bank',
            institutionName: 'Columbia Bank',
            links: [],
          },
        ],
      }),
    })
    renderCardDrawer()
    expect(await screen.findByText('Columbia Bank SOPs')).toBeInTheDocument()
    expect(screen.queryByText(/KeyBank/)).not.toBeInTheDocument()
  })

  it('completes the card through the queue mutation', async () => {
    const user = userEvent.setup()
    const onToggleComplete = renderCardDrawer()
    await user.click(await screen.findByTestId('drawer-complete-toggle'))
    expect(onToggleComplete).toHaveBeenCalledWith(true)
  })
})

describe('TaskDrawer month-close context', () => {
  const mockCloseSteps = vi.mocked(getCloseStepsAction)

  function closeStepsFixture(): CloseSteps {
    const steps = (
      [
        ['categorize', 'Categorize Transactions', 'complete'],
        ['reconcile', 'Reconcile Accounts', 'complete'],
        ['questions', 'Client Questions', 'in_progress'],
        ['reports', 'Send Reports', 'not_due'],
      ] as const
    ).map(([key, label, state]) => ({
      key,
      label,
      state,
      total: 2,
      completed: state === 'complete' ? 2 : 0,
      waiting: 0,
      open: state === 'complete' ? 0 : 2,
      overdue: 0,
    }))
    return {
      clientId: 1,
      year: 2026,
      month: 8,
      months: [8],
      today: '2026-08-15',
      steps,
      doneCount: 2,
      allDone: false,
    }
  }

  it('shows the month stepper for a recurring close-step task, with its step highlighted', async () => {
    mockCloseSteps.mockResolvedValue({ ok: true, data: closeStepsFixture() })
    render(
      <TaskDrawer
        card={TASK_CARD}
        open={true}
        closeContext={{ clientId: 1, year: 2026, month: 8, title: 'Client Questions' }}
        onOpenChange={() => {}}
        onToggleComplete={() => {}}
      />,
    )
    const strip = await screen.findByTestId('drawer-close-steps')
    expect(mockCloseSteps).toHaveBeenCalledWith(1, 2026, 8)
    expect(strip).toHaveTextContent('Month close - Aug 2026')
    const segments = strip.querySelectorAll('[data-testid="close-step"]')
    expect(segments).toHaveLength(4)
    // The open task's own step carries the context ring.
    const questions = strip.querySelector('[data-step="questions"]')!
    expect(questions.querySelector('span')!.className).toContain('ring-2')
  })

  it('stays hidden for tasks that are not close steps', async () => {
    render(
      <TaskDrawer
        card={TASK_CARD}
        open={true}
        closeContext={{ clientId: 1, year: 2026, month: 8, title: 'Weekly deposit review' }}
        onOpenChange={() => {}}
        onToggleComplete={() => {}}
      />,
    )
    expect(await screen.findByTestId('task-drawer-title')).toBeInTheDocument()
    expect(mockCloseSteps).not.toHaveBeenCalled()
    expect(screen.queryByTestId('drawer-close-steps')).not.toBeInTheDocument()
  })
})
