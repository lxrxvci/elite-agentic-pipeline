import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMeetingAction, updateMeetingAction } from '@/server/actions/calendar'

import { MeetingDialog } from '../meeting-dialog'

vi.mock('@/server/actions/calendar', () => ({
  createMeetingAction: vi.fn(),
  updateMeetingAction: vi.fn(),
}))

const mockCreate = vi.mocked(createMeetingAction)
const mockUpdate = vi.mocked(updateMeetingAction)

beforeAll(() => {
  // Radix Select needs pointer-capture APIs jsdom does not implement.
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

const CLIENTS = [
  { id: 1, name: 'Harborline Marine Supply' },
  { id: 2, name: 'Blue Spruce Landscaping' },
]

function renderDialog(overrides: Partial<Parameters<typeof MeetingDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  render(
    <MeetingDialog
      meeting={null}
      defaultDate="2026-08-12"
      clients={CLIENTS}
      timeZone="America/New_York"
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      {...overrides}
    />,
  )
  return { onOpenChange, onSaved }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ ok: true, data: { id: 42 } })
  mockUpdate.mockResolvedValue({ ok: true, data: { id: 7 } })
})

describe('MeetingDialog', () => {
  it('creates a meeting with the firm-local wall times and client', async () => {
    const { onSaved } = renderDialog()
    await userEvent.type(screen.getByLabelText(/title/i), 'August close review')
    await userEvent.click(screen.getByLabelText(/billable meeting/i))
    // Billable without a client blocks the save...
    expect(screen.getByRole('alert')).toHaveTextContent(/needs a client/i)
    expect(screen.getByTestId('meeting-save')).toBeDisabled()

    // ...until a client is picked.
    await userEvent.click(screen.getByLabelText(/client/i))
    await userEvent.click(screen.getByRole('option', { name: 'Harborline Marine Supply' }))
    const amount = screen.getByLabelText(/amount/i)
    await userEvent.type(amount, '150')
    expect(screen.getByTestId('meeting-save')).toBeEnabled()
    await userEvent.click(screen.getByTestId('meeting-save'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate).toHaveBeenCalledWith({
      clientId: 1,
      title: 'August close review',
      date: '2026-08-12',
      startTime: '10:00',
      endTime: '10:30',
      link: null,
      location: null,
      notes: null,
      billable: true,
      amount: '150',
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('prefills an existing meeting for editing', async () => {
    renderDialog({
      meeting: {
        id: 7,
        clientId: 2,
        clientName: 'Blue Spruce Landscaping',
        title: 'Quarterly planning',
        // 14:00-14:45 UTC = 10:00-10:45 AM in America/New_York (August, EDT).
        startsAt: '2026-08-14T14:00:00.000Z',
        endsAt: '2026-08-14T14:45:00.000Z',
        startLabel: '10:00 AM',
        endLabel: '10:45 AM',
        link: 'https://meet.google.com/abc-defg-hij',
        location: null,
        notes: 'Bring the P&L',
        billable: false,
        amount: null,
        billedInvoiceId: null,
        createdByName: 'Mara Ellison',
      },
    })
    expect(screen.getByLabelText(/title/i)).toHaveValue('Quarterly planning')
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('2026-08-14')
    expect(screen.getByLabelText(/start/i)).toHaveValue('10:00')
    expect(screen.getByLabelText(/end/i)).toHaveValue('10:45')
    expect(screen.getByLabelText(/join link/i)).toHaveValue('https://meet.google.com/abc-defg-hij')

    await userEvent.click(screen.getByTestId('meeting-save'))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0]).toBe(7)
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({
      clientId: 2,
      title: 'Quarterly planning',
      date: '2026-08-14',
      startTime: '10:00',
      endTime: '10:45',
      billable: false,
      amount: null,
    })
  })

  it('surfaces the engine error instead of closing', async () => {
    mockCreate.mockResolvedValue({ ok: false, error: 'The meeting must end after it starts' })
    renderDialog()
    await userEvent.type(screen.getByLabelText(/title/i), 'Broken')
    await userEvent.click(screen.getByTestId('meeting-save'))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    // Dialog stays open on failure.
    expect(screen.getByTestId('meeting-dialog')).toBeInTheDocument()
  })
})
