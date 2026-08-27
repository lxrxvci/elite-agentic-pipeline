import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  channelMembersAction,
  channelMessagesAction,
  markChannelReadAction,
  sendMessageAction,
} from '@/server/actions/chat'
import type { ChannelMessagesPage, ChatChannelSummary, ChatPerson } from '@/server/chat'

import { MessagePanel } from '../message-panel'

vi.mock('@/server/actions/chat', () => ({
  channelMessagesAction: vi.fn(),
  channelMembersAction: vi.fn(),
  sendMessageAction: vi.fn(),
  markChannelReadAction: vi.fn(),
}))

const mockSend = vi.mocked(sendMessageAction)
const mockMessages = vi.mocked(channelMessagesAction)
const mockMembers = vi.mocked(channelMembersAction)
const mockMarkRead = vi.mocked(markChannelReadAction)

const me: ChatPerson = { id: 1, name: 'Mara Ellison', initials: 'ME', role: 'owner' }

const members: ChatPerson[] = [
  me,
  { id: 5, name: 'Jorge Medina', initials: 'JM', role: 'bookkeeper' },
]

const channel: ChatChannelSummary = {
  id: 2,
  kind: 'dm',
  name: null,
  clientId: null,
  clientName: null,
  otherMember: members[1],
  memberCount: 2,
  lastMessage: null,
  unreadCount: 0,
  lastReadAt: null,
}

const thread: ChannelMessagesPage = {
  hasMore: false,
  messages: [
    {
      id: 10,
      channelId: 2,
      authorId: 5,
      authorName: 'Jorge Medina',
      authorInitials: 'JM',
      body: 'Morning @(1), the Harborline feed is stuck again',
      attachmentName: null,
      hasAttachment: false,
      createdAt: new Date(),
      editedAt: null,
    },
  ],
}

function renderPanel(onRead = vi.fn()) {
  render(
    <MessagePanel
      channel={channel}
      me={me}
      initialThread={thread}
      initialMembers={members}
      onRead={onRead}
    />,
  )
  return onRead
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkRead.mockResolvedValue({ ok: true, data: { read: true } })
  mockMessages.mockResolvedValue({ ok: true, data: { hasMore: false, messages: [] } })
  mockMembers.mockResolvedValue({ ok: true, data: members })
})

describe('MessagePanel', () => {
  it('renders messages with sender header, day divider, and mention chips', () => {
    renderPanel()
    // Channel header (h2) plus the sender header on the message.
    expect(screen.getAllByText('Jorge Medina')).toHaveLength(2)
    expect(screen.getByText('Today')).toBeInTheDocument()
    // @(1) resolves to a highlighted chip with the member's name.
    expect(screen.getByText('@Mara Ellison')).toBeInTheDocument()
    expect(
      screen.getByText(/the Harborline feed is stuck again/),
    ).toBeInTheDocument()
    // Viewing marks the channel read.
    expect(mockMarkRead).toHaveBeenCalledWith(2)
  })

  it('sends optimistically: the draft appears before the server replies', async () => {
    let settle!: (r: Awaited<ReturnType<typeof sendMessageAction>>) => void
    mockSend.mockReturnValue(
      new Promise((res) => {
        settle = res
      }),
    )
    const user = userEvent.setup()
    renderPanel()
    await user.type(screen.getByLabelText('Message'), 'On it, re-running now')
    await user.keyboard('{Enter}')

    // Optimistic row visible while the action is still in flight.
    expect(screen.getByText('On it, re-running now')).toBeInTheDocument()

    settle({
      ok: true,
      data: {
        message: {
          id: 99,
          channelId: 2,
          authorId: 1,
          authorName: 'Mara Ellison',
          authorInitials: 'ME',
          body: 'On it, re-running now',
          attachmentName: null,
          hasAttachment: false,
          createdAt: new Date(),
          editedAt: null,
        },
      },
    })
    await waitFor(() =>
      expect(screen.getByText('On it, re-running now')).toBeInTheDocument(),
    )
    const sent = mockSend.mock.calls[0][0]
    expect(sent.get('body')).toBe('On it, re-running now')
    expect(sent.get('channelId')).toBe('2')
  })

  it('rolls back the optimistic message and restores the draft on failure', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'The file is over the 50 MB upload limit.' })
    const user = userEvent.setup()
    renderPanel()
    const box = screen.getByLabelText('Message')
    const threadRegion = screen.getByLabelText('Messages in Jorge Medina')
    await user.type(box, 'failing send')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(within(threadRegion).queryByText('failing send')).not.toBeInTheDocument(),
    )
    // The composer restores the draft so nothing is lost.
    await waitFor(() => expect(box).toHaveValue('failing send'))
  })

  it('shows the empty-thread state', () => {
    render(
      <MessagePanel
        channel={channel}
        me={me}
        initialThread={{ hasMore: false, messages: [] }}
        initialMembers={members}
        onRead={vi.fn()}
      />,
    )
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('loads earlier pages with the before cursor', async () => {
    const paged: ChannelMessagesPage = { hasMore: true, messages: thread.messages }
    mockMessages.mockResolvedValue({
      ok: true,
      data: {
        hasMore: false,
        messages: [
          {
            ...thread.messages[0],
            id: 3,
            body: 'Earlier message',
            createdAt: new Date(Date.now() - 86_400_000),
          },
        ],
      },
    })
    const user = userEvent.setup()
    render(
      <MessagePanel
        channel={channel}
        me={me}
        initialThread={paged}
        initialMembers={members}
        onRead={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Load earlier messages/ }))
    expect(mockMessages).toHaveBeenCalledWith(2, { before: 10 })
    expect(await screen.findByText('Earlier message')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
  })
})
