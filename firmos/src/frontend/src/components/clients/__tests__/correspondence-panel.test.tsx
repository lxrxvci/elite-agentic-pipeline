import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientContactRow } from '@/server/clients'
import type { CorrespondenceItem, WaitingContextItem } from '@/server/correspondence'

import { CorrespondencePanel } from '../correspondence-panel'

// The panel's actions are the DB boundary; mock them like every jsdom suite.
const sendClientEmailAction = vi.fn(
  async (
    _input: unknown,
  ): Promise<
    { ok: true; data: { correspondenceId: number; to: string } } | { ok: false; error: string }
  > => ({ ok: true, data: { correspondenceId: 9, to: 'alison@harborlinemarine.com' } }),
)
const markCorrespondenceReadAction = vi.fn(async (_clientId: unknown) => ({ ok: true as const, data: { marked: 2 } }))
const sendWelcomeEmailAction = vi.fn(async (_clientId: unknown) => ({ ok: true as const, data: { sent: true } }))
vi.mock('@/server/actions/correspondence', () => ({
  sendClientEmailAction: (input: unknown) => sendClientEmailAction(input),
  markCorrespondenceReadAction: (clientId: unknown) => markCorrespondenceReadAction(clientId),
  sendWelcomeEmailAction: (clientId: unknown) => sendWelcomeEmailAction(clientId),
}))

const toast = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (msg: unknown) => toast(msg) } }))

/**
 * The client-record correspondence tab (walkthrough 02:28:57): two-way
 * history with unread markers, the "Email client" composer (contact,
 * subject, optional waiting-item link), and read-on-open badge clearing.
 */

const contacts: ClientContactRow[] = [
  {
    linkId: 1,
    contactId: 10,
    name: 'Alison Brewer',
    email: 'alison@harborlinemarine.com',
    phone: null,
    relationshipType: 'owner',
    ownershipPercent: '100',
    isPrimary: true,
    isCpa: false,
  },
  {
    linkId: 2,
    contactId: 11,
    name: 'No Email Person',
    email: null,
    phone: null,
    relationshipType: 'related',
    ownershipPercent: null,
    isPrimary: false,
    isCpa: false,
  },
]

const waitingItems: WaitingContextItem[] = [
  { kind: 'task', id: 42, title: 'Collect Chase login', note: null },
  { kind: 'bank_feed', id: 7, title: 'Bank feed week of 2026-08-17', note: 'Need the statement' },
]

function item(partial: Partial<CorrespondenceItem>): CorrespondenceItem {
  return {
    id: 1,
    direction: 'outbound',
    channel: 'email',
    subject: 'Welcome aboard',
    bodyText: 'Hello there',
    fromEmail: null,
    toEmail: 'alison@harborlinemarine.com',
    status: 'sent',
    template: 'staff_composer',
    taskId: null,
    taskTitle: null,
    contactName: 'Alison Brewer',
    sentByName: 'Dana Whitfield',
    portalVisible: true,
    staffReadAt: '2026-08-20T10:00:00.000Z',
    portalReadAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    ...partial,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof CorrespondencePanel>[0]> = {}) {
  return render(
    <CorrespondencePanel
      clientId={1}
      clientName="Harborline Marine Supply"
      rows={[]}
      unreadInbound={0}
      contacts={contacts}
      waitingItems={waitingItems}
      {...overrides}
    />,
  )
}

beforeAll(() => {
  // jsdom lacks pointer capture - Radix Select calls it on open.
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  sendClientEmailAction.mockReset()
  sendClientEmailAction.mockResolvedValue({ ok: true, data: { correspondenceId: 9, to: 'alison@harborlinemarine.com' } })
  markCorrespondenceReadAction.mockClear()
  sendWelcomeEmailAction.mockClear()
  toast.mockClear()
})

describe('CorrespondencePanel history', () => {
  it('renders the two-way history with direction and unread markers', () => {
    renderPanel({
      rows: [
        item({ id: 1, subject: 'Welcome aboard' }),
        item({
          id: 2,
          direction: 'inbound',
          status: 'received',
          subject: 'Re: Welcome aboard',
          bodyText: 'Thanks!',
          staffReadAt: null,
          portalReadAt: '2026-08-21T09:00:00.000Z',
        }),
      ],
      unreadInbound: 1,
    })
    const rows = screen.getAllByTestId('correspondence-row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveAttribute('data-direction', 'inbound')
    expect(rows[1]).toHaveAttribute('data-unread', 'true')
    expect(screen.getByTestId('correspondence-unread-dot')).toBeInTheDocument()
  })

  it('marks inbound replies read on open (badge clears on read)', async () => {
    renderPanel({ rows: [item({ id: 1, direction: 'inbound', staffReadAt: null })], unreadInbound: 1 })
    await waitFor(() => expect(markCorrespondenceReadAction).toHaveBeenCalledWith(1))
  })

  it('does not mark anything when there is nothing unread', async () => {
    renderPanel({ rows: [item({})], unreadInbound: 0 })
    await new Promise((r) => setTimeout(r, 20))
    expect(markCorrespondenceReadAction).not.toHaveBeenCalled()
  })

  it('renders the empty state', () => {
    renderPanel()
    expect(screen.getByText('No correspondence yet')).toBeInTheDocument()
  })
})

describe('CorrespondencePanel composer', () => {
  it('sends through the action with the picked contact and a task link', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByTestId('compose-email-open'))
    await user.type(screen.getByTestId('compose-subject'), 'Statement question')
    await user.type(screen.getByTestId('compose-body'), 'Which statement covers August?')

    // Link the waiting task via the select (Radix: open, then pick).
    await user.click(screen.getByTestId('compose-link'))
    await user.click(await screen.findByText('Collect Chase login'))

    await user.click(screen.getByTestId('compose-send'))
    await waitFor(() =>
      expect(sendClientEmailAction).toHaveBeenCalledWith({
        clientId: 1,
        contactId: 10, // the primary contact is preselected
        subject: 'Statement question',
        bodyText: 'Which statement covers August?',
        taskId: 42,
      }),
    )
  })

  it('shows the server reason when the send fails', async () => {
    sendClientEmailAction.mockResolvedValue({ ok: false, error: 'That contact has no email address on file' })
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('compose-email-open'))
    await user.type(screen.getByTestId('compose-subject'), 'Hi')
    await user.type(screen.getByTestId('compose-body'), 'Body')
    await user.click(screen.getByTestId('compose-send'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That contact has no email address on file'))
  })

  it('contacts without an email are not recipients', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByTestId('compose-email-open'))
    await user.click(screen.getByTestId('compose-to'))
    expect(screen.queryByText(/No Email Person/)).not.toBeInTheDocument()
  })
})

describe('CorrespondencePanel welcome action', () => {
  it('offers Send welcome email only to manager+ and calls the action', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPanel()
    expect(screen.queryByTestId('send-welcome')).not.toBeInTheDocument()
    unmount()

    renderPanel({ canSendWelcome: true })
    await user.click(screen.getByTestId('send-welcome'))
    await waitFor(() => expect(sendWelcomeEmailAction).toHaveBeenCalledWith(1))
  })
})
