import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Radix floating layers call pointer-capture APIs jsdom does not implement,
// and cmdk measures its list with ResizeObserver.
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

import {
  addQuickNoteAction,
  logMeetingAction,
  mintFromTemplateAction,
  quickAddOptionsAction,
  quickAddTaskAction,
} from '@/server/actions/quick-add'

import { CommandMenu } from '../../shell/command-menu'
import { QuickAddMenu, type QuickAddKind } from '../quick-add-menu'

vi.mock('@/server/actions/quick-add', () => ({
  quickAddOptionsAction: vi.fn(),
  addQuickNoteAction: vi.fn(),
  deleteQuickNoteAction: vi.fn(),
  listQuickNotesAction: vi.fn(),
  quickAddTaskAction: vi.fn(),
  mintFromTemplateAction: vi.fn(),
  logMeetingAction: vi.fn(),
}))

// The rebuilt palette (command-menu.tsx) pulls these action modules in;
// mock them so nothing reaches the DB layer from jsdom.
vi.mock('@/server/actions/search', () => ({
  globalSearchAction: vi.fn(),
  paletteContextAction: vi.fn().mockResolvedValue({ ok: true, data: { role: 'owner' } }),
}))
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { clockedIn: false, dayElapsedMinutes: 0, dayStartedAt: null, currentActivity: null, openTaskTimers: [] },
  }),
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
}))
vi.mock('@/server/actions/invoices', () => ({
  generateMonthlyInvoicesAction: vi.fn(),
}))

const OPTIONS = {
  clients: [
    { id: 1, name: 'Harborline Marine Supply' },
    { id: 2, name: 'Dusk IT Services' },
  ],
  staff: [
    { id: 10, name: 'Dana Whitfield' },
    { id: 11, name: 'Jorge Medina' },
  ],
  templates: [{ id: 20, title: 'Chase missing W-9', dueInDays: 5 }],
}

const mockOptions = vi.mocked(quickAddOptionsAction)
const mockNote = vi.mocked(addQuickNoteAction)
const mockTask = vi.mocked(quickAddTaskAction)
const mockTemplate = vi.mocked(mintFromTemplateAction)
const mockMeeting = vi.mocked(logMeetingAction)

beforeEach(() => {
  vi.clearAllMocks()
  mockOptions.mockResolvedValue({ ok: true, data: OPTIONS })
  mockNote.mockResolvedValue({ ok: true, data: { id: 99 } as never })
  mockTask.mockResolvedValue({ ok: true, data: { id: 100 } as never })
  mockTemplate.mockResolvedValue({ ok: true, data: { id: 101, title: 'Chase missing W-9' } as never })
  mockMeeting.mockResolvedValue({ ok: true, data: { task: { id: 102 }, timeEntry: { id: 103 } } as never })
})

function Harness() {
  const [dialog, setDialog] = React.useState<QuickAddKind | null>(null)
  return <QuickAddMenu dialog={dialog} onDialogChange={setDialog} />
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('quick-add-trigger'))
  await waitFor(() => expect(mockOptions).toHaveBeenCalled())
}

describe('QuickAddMenu', () => {
  it('opens from the top-bar button and lists all four actions', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openMenu(user)
    expect(screen.getByTestId('quick-add-note')).toHaveTextContent('Quick note')
    expect(screen.getByTestId('quick-add-task')).toHaveTextContent('New task')
    expect(screen.getByTestId('quick-add-template')).toHaveTextContent('Task from template')
    expect(screen.getByTestId('quick-add-meeting')).toHaveTextContent('Log meeting')
  })

  it('quick note dialog submits a firm-wide note', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openMenu(user)
    await user.click(screen.getByTestId('quick-add-note'))

    await user.type(screen.getByLabelText('Note'), 'Call the CPA about Q3 estimates')
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() =>
      expect(mockNote).toHaveBeenCalledWith({
        clientId: null,
        body: 'Call the CPA about Q3 estimates',
      }),
    )
  })

  it('new task dialog submits client, assignee, due date, subtasks, and billable', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openMenu(user)
    await user.click(screen.getByTestId('quick-add-task'))

    await user.type(screen.getByLabelText('Title'), 'Chase July statement')

    await user.click(screen.getByRole('combobox', { name: 'Client' }))
    await user.click(await screen.findByRole('option', { name: 'Harborline Marine Supply' }))

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(await screen.findByRole('option', { name: 'Dana Whitfield' }))

    await user.type(screen.getByLabelText('Due date'), '2026-08-28')
    await user.type(screen.getByLabelText('Subtasks'), 'Email Alison\nDownload the PDF')
    await user.click(screen.getByLabelText('Billable'))

    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(mockTask).toHaveBeenCalledWith({
        clientId: 1,
        title: 'Chase July statement',
        assigneeId: 10,
        dueDate: '2026-08-28',
        subtasks: ['Email Alison', 'Download the PDF'],
        billableStatus: 'billable',
      }),
    )
  })

  it('task from template dialog submits template + client', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openMenu(user)
    await user.click(screen.getByTestId('quick-add-template'))

    await user.click(screen.getByRole('combobox', { name: 'Template' }))
    await user.click(await screen.findByRole('option', { name: /Chase missing W-9/ }))
    await user.click(screen.getByRole('combobox', { name: 'Client' }))
    await user.click(await screen.findByRole('option', { name: 'Dusk IT Services' }))

    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(mockTemplate).toHaveBeenCalledWith(20, 2))
  })

  it('log meeting dialog submits title, client, duration, and billable', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openMenu(user)
    await user.click(screen.getByTestId('quick-add-meeting'))

    await user.type(screen.getByLabelText('What was it about?'), 'Quarterly review')
    await user.click(screen.getByRole('combobox', { name: 'Client' }))
    await user.click(await screen.findByRole('option', { name: 'Harborline Marine Supply' }))

    const duration = screen.getByLabelText('Duration (min)')
    await user.clear(duration)
    await user.type(duration, '45')
    await user.click(screen.getByLabelText('Billable')) // default on; toggle off

    await user.click(screen.getByRole('button', { name: 'Log meeting' }))
    await waitFor(() =>
      expect(mockMeeting).toHaveBeenCalledWith({
        clientId: 1,
        title: 'Quarterly review',
        durationMinutes: 45,
        billable: false,
      }),
    )
  })

  it('keeps the dialog open and shows the error when the action fails', async () => {
    const user = userEvent.setup()
    mockNote.mockResolvedValue({ ok: false, error: 'Note body must not be empty' })
    render(<Harness />)
    await openMenu(user)
    await user.click(screen.getByTestId('quick-add-note'))

    await user.type(screen.getByLabelText('Note'), 'x')
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Note body must not be empty')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('CommandMenu quick-add entries', () => {
  it('lists the four quick-add actions and routes selections to onQuickAdd', async () => {
    const user = userEvent.setup()
    const onQuickAdd = vi.fn()
    const onOpenChange = vi.fn()
    render(<CommandMenu open={true} onOpenChange={onOpenChange} onQuickAdd={onQuickAdd} />)

    for (const label of ['Quick note', 'New task', 'Task from template', 'Log meeting']) {
      expect(screen.getByRole('option', { name: new RegExp(label) })).toBeInTheDocument()
    }
    // Navigation still works.
    expect(screen.getByRole('option', { name: /Workstation/ })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Log meeting/ }))
    expect(onQuickAdd).toHaveBeenCalledWith('meeting')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
