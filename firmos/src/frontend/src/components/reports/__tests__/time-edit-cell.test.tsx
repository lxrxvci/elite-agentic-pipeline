import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { submitTimeEditAction } from '@/server/actions/time'

import { TimeEditCell, type EditableEntry } from '../time-edit-cell'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  usePathname: () => '/reports/my-hours',
}))

vi.mock('@/server/actions/time', () => ({
  submitTimeEditAction: vi.fn(),
}))

const entry: EditableEntry = {
  entryId: 77,
  activityType: 'bank_feeds',
  clientName: 'Harborline Marine Supply',
  startedAt: '2026-08-20T14:00:00.000Z',
  endedAt: '2026-08-20T16:00:00.000Z',
  editStatus: null,
}

beforeEach(() => vi.clearAllMocks())

describe('TimeEditCell', () => {
  it('shows the pending chip when a request is already open', () => {
    render(<TimeEditCell entry={{ ...entry, editStatus: 'pending' }} />)
    const chip = screen.getByText('Edit pending')
    expect(chip.closest('[data-status]')).toHaveAttribute('data-status', 'due_soon')
    expect(screen.queryByRole('button', { name: /request edit/i })).not.toBeInTheDocument()
  })

  it('submits corrected times and reason, then refreshes', async () => {
    vi.mocked(submitTimeEditAction).mockResolvedValue({ ok: true, data: { requestId: 9 } })
    render(<TimeEditCell entry={entry} />)

    await userEvent.click(screen.getByRole('button', { name: /request edit/i }))
    const dialog = await screen.findByRole('dialog')

    const reason = screen.getByLabelText(/reason/i)
    await userEvent.type(reason, 'Forgot to clock out at lunch')
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }))

    expect(submitTimeEditAction).toHaveBeenCalledTimes(1)
    const [entryId, startIso, endIso, reasonText] = vi.mocked(submitTimeEditAction).mock.calls[0]
    expect(entryId).toBe(77)
    expect(typeof startIso).toBe('string')
    expect(typeof endIso).toBe('string')
    expect(reasonText).toBe('Forgot to clock out at lunch')
    expect(refresh).toHaveBeenCalled()
    expect(dialog).not.toBeInTheDocument()
  })

  it('shows the server error verbatim when the submit fails', async () => {
    vi.mocked(submitTimeEditAction).mockResolvedValue({
      ok: false,
      error: 'correctedEnd must be after correctedStart',
    })
    render(<TimeEditCell entry={entry} />)

    await userEvent.click(screen.getByRole('button', { name: /request edit/i }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'correctedEnd must be after correctedStart',
    )
    expect(refresh).not.toHaveBeenCalled()
  })
})
