import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  portalChatMessagesAction,
  portalChatReadAction,
  portalChatSendAction,
} from '@/server/actions/portal-chat'
import type { ChannelMessagesPage, ChatMessageView, ChatPerson } from '@/server/chat'

import { PortalChatView } from '../chat-view'

vi.mock('@/server/actions/portal-chat', () => ({
  portalChatMessagesAction: vi.fn(),
  portalChatSendAction: vi.fn(),
  portalChatReadAction: vi.fn(),
}))

const mockMessages = vi.mocked(portalChatMessagesAction)
const mockSend = vi.mocked(portalChatSendAction)
const mockRead = vi.mocked(portalChatReadAction)

const me: ChatPerson = { id: 40, name: 'Alison Brewer', initials: 'AB', role: 'client' }

const team: ChatPerson[] = [
  { id: 5, name: 'Jorge Medina', initials: 'JM', role: 'bookkeeper' },
  { id: 3, name: 'Dana Whitfield', initials: 'DW', role: 'manager' },
]

function message(partial: Partial<ChatMessageView>): ChatMessageView {
  return {
    id: 1,
    channelId: 2,
    authorId: 5,
    authorName: 'Jorge Medina',
    authorInitials: 'JM',
    body: 'Your July close is ready for review.',
    attachmentName: null,
    hasAttachment: false,
    createdAt: new Date(),
    editedAt: null,
    ...partial,
  }
}

function thread(messages: ChatMessageView[]): ChannelMessagesPage {
  return { hasMore: false, messages }
}

function renderView(initial = thread([message({})])) {
  return render(
    <PortalChatView
      clientName="Harborline Marine Supply"
      me={me}
      team={team}
      initialThread={initial}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMessages.mockResolvedValue({ ok: true, data: { hasMore: false, messages: [] } })
  mockRead.mockResolvedValue({ ok: true, data: { read: true } })
  mockSend.mockResolvedValue({ ok: true, data: { message: message({ id: 99, authorId: me.id }) } })
})

describe('PortalChatView', () => {
  it('renders the server-provided thread and marks own messages', () => {
    renderView(
      thread([
        message({ id: 1 }),
        message({ id: 2, authorId: me.id, authorName: me.name, body: 'Thanks, looking now.' }),
      ]),
    )
    expect(screen.getByText('Your July close is ready for review.')).toBeInTheDocument()
    expect(screen.getByText('Thanks, looking now.')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('is text-only: no attachment affordance anywhere', () => {
    renderView()
    expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByText(/text only here/i)).toBeInTheDocument()
  })

  it('sends the typed body through the portal action', async () => {
    renderView()
    await userEvent.type(screen.getByLabelText('Message'), 'Where is my August statement?')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('Where is my August statement?'))
  })

  it('restores the draft and rolls back the optimistic message on failure', async () => {
    mockSend.mockResolvedValue({ ok: false, status: 403, error: 'Messaging is off' })
    renderView()
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'hello')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))
    await waitFor(() => expect(box).toHaveValue('hello'))
    expect(screen.queryByText('hello', { selector: 'p' })).not.toBeInTheDocument()
  })

  it('shows the empty state with the team names', () => {
    renderView(thread([]))
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Jorge Medina, Dana Whitfield/)).toBeInTheDocument()
  })
})
