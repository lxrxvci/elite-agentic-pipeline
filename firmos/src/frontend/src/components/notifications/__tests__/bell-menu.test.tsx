import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bellSummaryAction,
  markNotificationsReadAction,
} from '@/server/actions/notifications'
import type { NotificationRow } from '@/server/notifications'

import { NotificationsBell } from '../bell-menu'

vi.mock('@/server/actions/notifications', () => ({
  bellSummaryAction: vi.fn(),
  markNotificationsReadAction: vi.fn(),
}))

const mockSummary = vi.mocked(bellSummaryAction)
const mockMarkRead = vi.mocked(markNotificationsReadAction)

function row(partial: Partial<NotificationRow>): NotificationRow {
  return {
    id: 1,
    userId: 1,
    notificationType: 'task_overdue',
    title: 'Task overdue',
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

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkRead.mockResolvedValue({ ok: true, data: { updated: 1 } })
})

describe('NotificationsBell', () => {
  it('shows no badge when there is nothing unread', async () => {
    mockSummary.mockResolvedValue({ ok: true, data: { unreadCount: 0, recent: [] } })
    render(<NotificationsBell pollMs={60_000} />)

    await waitFor(() => expect(mockSummary).toHaveBeenCalled())
    expect(screen.queryByTestId('bell-badge')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('badges the bell with the unread count', async () => {
    mockSummary.mockResolvedValue({
      ok: true,
      data: { unreadCount: 3, recent: [row({ id: 1 })] },
    })
    render(<NotificationsBell pollMs={60_000} />)

    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('3')
    expect(
      screen.getByRole('button', { name: 'Notifications, 3 unread' }),
    ).toBeInTheDocument()
  })

  it('opens to the empty state when nothing is pending', async () => {
    mockSummary.mockResolvedValue({ ok: true, data: { unreadCount: 0, recent: [] } })
    render(<NotificationsBell pollMs={60_000} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText(/you're all caught up/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view all notifications/i })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  it('lists recent rows with priority markers and marks read on click', async () => {
    mockSummary.mockResolvedValue({
      ok: true,
      data: {
        unreadCount: 2,
        recent: [
          row({ id: 7, title: 'Statement overdue', link: '/statements', priority: 'urgent' }),
          row({ id: 8, title: 'Client replied', link: '/clients/3', isRead: true }),
        ],
      },
    })
    render(<NotificationsBell pollMs={60_000} />)

    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }))
    expect(await screen.findByText('Statement overdue')).toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()
    expect(screen.getByText('Client replied')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Statement overdue'))
    expect(mockMarkRead).toHaveBeenCalledWith([7])
  })
})
