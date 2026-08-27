import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addTaskNoteAction, getTaskDetailAction, setSubtaskCompletedAction } from '@/server/actions/tasks'
import type { TaskDetail } from '@/server/task-detail'

import { TaskDrawer } from '../task-drawer'

// Radix primitives call pointer-capture APIs jsdom does not implement.
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

vi.mock('@/server/actions/tasks', () => ({
  getTaskDetailAction: vi.fn(),
  setSubtaskCompletedAction: vi.fn(),
  addTaskNoteAction: vi.fn(),
}))

// The drawer reuses the card's timer toggle, which dynamic-imports these.
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn().mockResolvedValue({ ok: true, data: { openTaskTimers: [] } }),
  startTaskTimerAction: vi.fn(),
  stopTaskTimerAction: vi.fn(),
}))

const mockDetail = vi.mocked(getTaskDetailAction)
const mockToggle = vi.mocked(setSubtaskCompletedAction)
const mockAddNote = vi.mocked(addTaskNoteAction)

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
        links: ['https://www.loom.com/share/abc123'],
      },
    ],
    manualEntries: [
      { id: 41, title: 'Harborline-only quirk', content: 'They round cash deposits.', updatedAt: '2026-07-15T12:00:00.000Z' },
    ],
    today: '2026-08-15',
    ...partial,
  }
}

function renderDrawer(onToggleComplete = vi.fn()) {
  render(
    <TaskDrawer taskId={42} open={true} onOpenChange={() => {}} onToggleComplete={onToggleComplete} />,
  )
  return onToggleComplete
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDetail.mockResolvedValue({ ok: true, data: detail() })
  mockToggle.mockResolvedValue({ ok: true, data: { subtaskId: 12, isCompleted: true } })
  mockAddNote.mockResolvedValue({ ok: true, data: { noteId: 99 } })
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
    expect(card).toHaveTextContent('chevron wex')
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

  it('delegates completion to the queue handler', async () => {
    const onToggleComplete = renderDrawer()
    const button = await screen.findByTestId('drawer-complete-toggle')
    expect(button).toHaveTextContent('Complete task')
    await userEvent.click(button)
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
