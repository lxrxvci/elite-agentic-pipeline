import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChatChannelSummary } from '@/server/chat'

import { ChannelList } from '../channel-list'

function channel(partial: Partial<ChatChannelSummary> & Pick<ChatChannelSummary, 'id' | 'kind'>): ChatChannelSummary {
  return {
    name: null,
    clientId: null,
    clientName: null,
    otherMember: null,
    memberCount: 2,
    lastMessage: null,
    unreadCount: 0,
    lastReadAt: null,
    ...partial,
  }
}

const channels: ChatChannelSummary[] = [
  channel({
    id: 1,
    kind: 'general',
    name: 'General',
    memberCount: 6,
    lastMessage: {
      id: 11,
      authorName: 'Mara Ellison',
      preview: 'Morning all, close kickoff at 9:30',
      createdAt: new Date(),
    },
  }),
  channel({
    id: 2,
    kind: 'dm',
    otherMember: { id: 5, name: 'Jorge Medina', initials: 'JM', role: 'bookkeeper' },
    unreadCount: 3,
    lastMessage: {
      id: 12,
      authorName: 'Jorge Medina',
      preview: 'Can you look at the Amex feed?',
      createdAt: new Date(),
    },
  }),
  channel({
    id: 3,
    kind: 'client_portal',
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    name: 'Harborline Marine Supply',
    memberCount: 4,
  }),
]

function renderList(overrides: Partial<Parameters<typeof ChannelList>[0]> = {}) {
  return render(
    <ChannelList
      channels={channels}
      selectedId={null}
      presenceUserIds={new Set([5])}
      onSelect={vi.fn()}
      onNewMessage={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ChannelList', () => {
  it('renders general first, DMs with presence, client channels with the client name', () => {
    renderList()
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('General')
    expect(options[1]).toHaveTextContent('Jorge Medina')
    expect(options[2]).toHaveTextContent('Harborline Marine Supply')
    expect(options[2]).toHaveTextContent('Client channel')
    // Jorge (id 5) is in the presence set.
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument()
  })

  it('shows unread chips only on channels with unread messages', () => {
    renderList()
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument()
    expect(screen.queryByLabelText('0 unread')).not.toBeInTheDocument()
    // Unread channel name is emphasized, not color-alone.
    const dmRow = screen.getByRole('option', { name: /Jorge Medina/ })
    expect(dmRow.querySelector('.font-semibold')).not.toBeNull()
  })

  it('calls onSelect when a channel is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderList({ onSelect })
    await user.click(screen.getByRole('option', { name: /Jorge Medina/ }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('filters by search and shows the no-results empty state', async () => {
    const user = userEvent.setup()
    renderList()
    await user.type(screen.getByLabelText('Search conversations'), 'harbor')
    expect(screen.getByRole('option', { name: /Harborline/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Jorge Medina/ })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search conversations'))
    await user.type(screen.getByLabelText('Search conversations'), 'zzzz')
    expect(screen.getByText('No conversations match your search.')).toBeInTheDocument()
  })

  it('shows the no-channels empty state', () => {
    renderList({ channels: [] })
    expect(
      screen.getByText('No conversations yet. Start a direct message to get going.'),
    ).toBeInTheDocument()
  })

  it('opens the new-message flow from the header button', async () => {
    const user = userEvent.setup()
    const onNewMessage = vi.fn()
    renderList({ onNewMessage })
    await user.click(screen.getByLabelText('Start a new direct message'))
    expect(onNewMessage).toHaveBeenCalled()
  })
})
