import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearResolvedNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationsReadAction,
  resolveNotificationsAction,
} from '@/server/actions/notifications'
import type { NotificationRow } from '@/server/notifications'

import { NotificationsList } from '../notifications-list'

vi.mock('@/server/actions/notifications', () => ({
  clearResolvedNotificationsAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
  markNotificationsReadAction: vi.fn(),
  resolveNotificationsAction: vi.fn(),
}))

const mockMarkRead = vi.mocked(markNotificationsReadAction)
const mockResolve = vi.mocked(resolveNotificationsAction)
const mockClearResolved = vi.mocked(clearResolvedNotificationsAction)

function row(partial: Partial<NotificationRow>): NotificationRow {
  return {
    id: 1,
    userId: 1,
    notificationType: 'task_overdue',
    title: 'Row',
    message: null,
    link: null,
    entityType: null,
    entityId: null,
    priority: 'normal',
    isRead: false,
    readAt: null,
    isResolved: false,
    resolvedAt: null,
    smsSentAt: null,
    pushSentAt: null,
    createdAt: new Date(),
    ...partial,
  }
}

const ROWS: NotificationRow[] = [
  row({ id: 1, title: 'Unread alert' }),
  row({ id: 2, title: 'Read alert', isRead: true }),
  row({ id: 3, title: 'Done alert', isRead: true, isResolved: true }),
]

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkRead.mockResolvedValue({ ok: true, data: { updated: 1 } })
  mockResolve.mockResolvedValue({ ok: true, data: { updated: 1 } })
  mockClearResolved.mockResolvedValue({ ok: true, data: { cleared: 1 } })
  vi.mocked(markAllNotificationsReadAction).mockResolvedValue({ ok: true, data: { updated: 2 } })
})

describe('NotificationsList', () => {
  it('defaults to the unread filter', () => {
    render(<NotificationsList initialRows={ROWS} />)
    expect(screen.getByText('Unread alert')).toBeInTheDocument()
    expect(screen.queryByText('Read alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Done alert')).not.toBeInTheDocument()
  })

  it('switches between all, unread, and resolved filters', async () => {
    render(<NotificationsList initialRows={ROWS} />)

    await userEvent.click(screen.getByRole('tab', { name: /^all$/i }))
    expect(screen.getAllByTestId('notification-row')).toHaveLength(3)

    await userEvent.click(screen.getByRole('tab', { name: /resolved/i }))
    expect(screen.getByText('Done alert')).toBeInTheDocument()
    expect(screen.queryByText('Unread alert')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /unread/i }))
    expect(screen.getByText('Unread alert')).toBeInTheDocument()
    expect(screen.queryByText('Done alert')).not.toBeInTheDocument()
  })

  it('marks a row read and resolves another via the row actions', async () => {
    render(<NotificationsList initialRows={ROWS} />)

    await userEvent.click(screen.getByRole('tab', { name: /^all$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark read: Unread alert' }))
    expect(mockMarkRead).toHaveBeenCalledWith([1])

    await userEvent.click(screen.getByRole('button', { name: 'Resolve: Read alert' }))
    expect(mockResolve).toHaveBeenCalledWith([2])
  })

  it('clears resolved rows from the toolbar', async () => {
    render(<NotificationsList initialRows={ROWS} />)

    await userEvent.click(screen.getByRole('tab', { name: /^all$/i }))
    await userEvent.click(screen.getByRole('button', { name: /clear resolved/i }))
    expect(mockClearResolved).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Done alert')).not.toBeInTheDocument()
  })
})
