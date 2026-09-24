import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CorrespondenceItem } from '@/server/correspondence'

import { PortalCorrespondenceList } from '../correspondence-list'

// The read-marking action is the DB boundary (same mock pattern as shell tests).
const markPortalMessagesRead = vi.fn(async (_clientId: unknown) => ({ ok: true as const, data: { marked: 1 } }))
vi.mock('@/server/actions/portal', () => ({
  markPortalMessagesRead: (clientId: unknown) => markPortalMessagesRead(clientId),
}))

/**
 * Portal correspondence (walkthrough 02:28:57): the client's message history
 * with unread badges; reading the section marks the firm's mail read.
 */

function item(partial: Partial<CorrespondenceItem>): CorrespondenceItem {
  return {
    id: 1,
    direction: 'outbound',
    channel: 'email',
    subject: 'A few things we still need',
    bodyText: 'Here is the list',
    fromEmail: null,
    toEmail: 'alison@harborlinemarine.com',
    status: 'sent',
    template: 'missing_info_reminder',
    taskId: null,
    taskTitle: null,
    contactName: null,
    sentByName: 'Dana',
    portalVisible: true,
    staffReadAt: null,
    portalReadAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    ...partial,
  }
}

beforeEach(() => {
  markPortalMessagesRead.mockClear()
})

describe('PortalCorrespondenceList', () => {
  it('renders the badge count and unread markers on unread firm mail', () => {
    render(
      <PortalCorrespondenceList
        clientId={1}
        unreadCount={1}
        rows={[
          item({ id: 1 }),
          item({
            id: 2,
            direction: 'inbound',
            subject: null,
            bodyText: 'My reply',
            portalReadAt: '2026-08-21T09:00:00.000Z',
          }),
        ]}
      />,
    )
    expect(screen.getByTestId('portal-messages-badge')).toHaveTextContent('1 new')
    const rows = screen.getAllByTestId('portal-message-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-unread', 'true')
    expect(rows[1]).not.toHaveAttribute('data-unread')
    // The client's own reply reads "From you"; subjects fall back gracefully.
    expect(rows[1]).toHaveTextContent('From you')
    expect(rows[1]).toHaveTextContent('(no subject)')
  })

  it('marks the firm mail read once the section is seen', async () => {
    render(<PortalCorrespondenceList clientId={3} unreadCount={2} rows={[item({})]} />)
    await waitFor(() => expect(markPortalMessagesRead).toHaveBeenCalledWith(3))
  })

  it('skips the read-marking call when nothing is unread', async () => {
    render(
      <PortalCorrespondenceList
        clientId={3}
        unreadCount={0}
        rows={[item({ portalReadAt: '2026-08-21T09:00:00.000Z' })]}
      />,
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(markPortalMessagesRead).not.toHaveBeenCalled()
  })

  it('renders the friendly empty state', () => {
    render(<PortalCorrespondenceList clientId={3} unreadCount={0} rows={[]} />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
    expect(screen.queryByTestId('portal-messages-badge')).not.toBeInTheDocument()
  })
})
