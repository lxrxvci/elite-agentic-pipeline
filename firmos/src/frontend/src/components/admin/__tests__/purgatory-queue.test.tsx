import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { AdminQueueItem } from '@/server/admin-reads'
import {
  reviewPauseAction,
  reviewPortalChangeAction,
  reviewPurgeAction,
  reviewResetAction,
  reviewWorkingHoursAction,
} from '@/server/actions/approvals'
import { reviewTimeEditAction } from '@/server/actions/time'

import { PurgatoryQueue } from '../purgatory-queue'

vi.mock('@/server/actions/approvals', () => ({
  reviewPauseAction: vi.fn(),
  reviewPortalChangeAction: vi.fn(),
  reviewPurgeAction: vi.fn(),
  reviewResetAction: vi.fn(),
  reviewWorkingHoursAction: vi.fn(),
}))
vi.mock('@/server/actions/time', () => ({
  reviewTimeEditAction: vi.fn(),
}))

const mockReviewPause = vi.mocked(reviewPauseAction)
const mockReviewPurge = vi.mocked(reviewPurgeAction)

function item(partial: Partial<AdminQueueItem>): AdminQueueItem {
  return {
    group: 'pause',
    id: 1,
    requestedById: 99,
    requesterName: 'Dana Whitfield',
    target: 'Harborline Marine',
    detail: 'Seasonal slowdown',
    createdAt: new Date(),
    ...partial,
  }
}

function renderQueue(items: AdminQueueItem[], viewer: { id: number; role: 'admin' | 'owner' }) {
  return render(
    <TooltipProvider>
      <PurgatoryQueue items={items} viewer={viewer} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReviewPause.mockResolvedValue({ ok: true, data: { status: 'approved' } })
  mockReviewPurge.mockResolvedValue({ ok: true, data: { status: 'approved' } })
  vi.mocked(reviewResetAction).mockResolvedValue({ ok: true, data: { status: 'approved' } })
  vi.mocked(reviewPortalChangeAction).mockResolvedValue({ ok: true, data: { status: 'approved' } })
  vi.mocked(reviewWorkingHoursAction).mockResolvedValue({ ok: true, data: { status: 'approved' } })
  vi.mocked(reviewTimeEditAction).mockResolvedValue({ ok: true, data: { status: 'approved' } })
})

describe('PurgatoryQueue', () => {
  it('renders the empty state when nothing is pending', () => {
    renderQueue([], { id: 1, role: 'owner' })
    expect(screen.getByText(/nothing pending review/i)).toBeInTheDocument()
  })

  it('disables approve for the requester (four-eyes)', () => {
    renderQueue([item({ requestedById: 42 })], { id: 42, role: 'admin' })
    const row = screen.getByTestId('purgatory-item')
    expect(within(row).getByRole('button', { name: /^approve$/i })).toBeDisabled()
    // Reject stays available - the rule blocks approval, not review.
    expect(within(row).getByRole('button', { name: /^reject$/i })).toBeEnabled()
  })

  it('lets a different admin approve a pause request', async () => {
    renderQueue([item({ id: 5, requestedById: 42 })], { id: 1, role: 'admin' })
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(mockReviewPause).toHaveBeenCalledWith(5, true)
  })

  it('blocks purge review for non-owners even when they did not request it', () => {
    renderQueue([item({ group: 'purge', id: 9, requestedById: 42 })], { id: 1, role: 'admin' })
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled()
  })

  it('arms a confirm before approving a destructive purge', async () => {
    renderQueue([item({ group: 'purge', id: 9, requestedById: 42 })], { id: 1, role: 'owner' })

    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(mockReviewPurge).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /confirm - irreversible/i }))
    expect(mockReviewPurge).toHaveBeenCalledWith(9, true)
  })
})
