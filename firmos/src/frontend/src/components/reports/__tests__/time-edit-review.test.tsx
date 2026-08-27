import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reviewTimeEditAction } from '@/server/actions/time'

import { TimeEditReview, type TimeEditRow } from '../time-edit-review'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  usePathname: () => '/reports/time-edits',
}))

vi.mock('@/server/actions/time', () => ({
  reviewTimeEditAction: vi.fn(),
}))

const pendingRow: TimeEditRow = {
  requestId: 5,
  status: 'pending',
  requesterName: 'Jorge Medina',
  reviewerName: null,
  reviewedAt: null,
  createdAt: '2026-08-21T13:00:00.000Z',
  reason: 'System clocked me out early',
  activityType: 'tasks',
  clientName: 'Harborline Marine Supply',
  originalStartedAt: '2026-08-20T14:00:00.000Z',
  originalEndedAt: '2026-08-20T16:00:00.000Z',
  requestedStartedAt: '2026-08-20T14:00:00.000Z',
  requestedEndedAt: '2026-08-20T17:30:00.000Z',
}

const approvedRow: TimeEditRow = {
  ...pendingRow,
  requestId: 3,
  status: 'approved',
  reviewerName: 'Mara Ellison',
  reviewedAt: '2026-08-21T15:00:00.000Z',
}

beforeEach(() => vi.clearAllMocks())

describe('TimeEditReview', () => {
  it('renders the pending queue with old -> new times and reason', () => {
    render(<TimeEditReview rows={[pendingRow]} />)
    const row = screen.getByTestId('time-edit-pending')
    expect(row).toHaveTextContent('Jorge Medina')
    expect(row).toHaveTextContent('Tasks · Harborline Marine Supply')
    expect(row).toHaveTextContent('System clocked me out early')
    expect(screen.getByRole('button', { name: /approve jorge medina/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject jorge medina/i })).toBeInTheDocument()
  })

  it('approve calls the review action and refreshes', async () => {
    vi.mocked(reviewTimeEditAction).mockResolvedValue({ ok: true, data: { status: 'approved' } })
    render(<TimeEditReview rows={[pendingRow]} />)
    await userEvent.click(screen.getByRole('button', { name: /approve jorge medina/i }))
    expect(reviewTimeEditAction).toHaveBeenCalledWith(5, true)
    expect(refresh).toHaveBeenCalled()
  })

  it('reject calls the review action with approve=false', async () => {
    vi.mocked(reviewTimeEditAction).mockResolvedValue({ ok: true, data: { status: 'rejected' } })
    render(<TimeEditReview rows={[pendingRow]} />)
    await userEvent.click(screen.getByRole('button', { name: /reject jorge medina/i }))
    expect(reviewTimeEditAction).toHaveBeenCalledWith(5, false)
  })

  it('shows a self-review server error verbatim', async () => {
    vi.mocked(reviewTimeEditAction).mockResolvedValue({
      ok: false,
      error: 'You cannot review your own time edit request',
    })
    render(<TimeEditReview rows={[pendingRow]} />)
    await userEvent.click(screen.getByRole('button', { name: /approve jorge medina/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot review your own time edit request',
    )
  })

  it('renders history rows with outcome chips and reviewer', () => {
    render(<TimeEditReview rows={[approvedRow]} />)
    const row = screen.getByTestId('time-edit-history')
    expect(row).toHaveTextContent('Mara Ellison')
    const chip = screen.getByText('Approved')
    expect(chip.closest('[data-status]')).toHaveAttribute('data-status', 'on_track')
  })
})
