import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { submitWorkingHoursAction } from '@/server/actions/approvals'
import type { WorkingHoursStatus } from '@/server/approvals'

import { WorkingHoursSettings } from '../working-hours-settings'

/**
 * Clock-C3 working-hours editor: the weekly grid submits the §16 JSON shape,
 * the pending state locks the card behind the review chip, the approved
 * schedule renders read-only, and the rejection path invites a resubmit.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  usePathname: () => '/account/security',
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/server/actions/approvals', () => ({
  submitWorkingHoursAction: vi.fn(),
}))

const EMPTY: WorkingHoursStatus = { approved: null, pending: null, rejected: null }

const NINE_TO_FIVE = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
}

beforeEach(() => vi.clearAllMocks())

describe('WorkingHoursSettings', () => {
  it('submits the weekly grid as §16 schedule JSON, then refreshes', async () => {
    vi.mocked(submitWorkingHoursAction).mockResolvedValue({ ok: true, data: { requestId: 5 } })
    render(<WorkingHoursSettings status={EMPTY} timeZone="America/Los_Angeles" />)

    await userEvent.type(screen.getByLabelText('Monday start'), '09:00')
    await userEvent.type(screen.getByLabelText('Monday end'), '17:00')
    await userEvent.type(screen.getByLabelText('Tuesday start'), '09:00')
    await userEvent.type(screen.getByLabelText('Tuesday end'), '17:00')
    await userEvent.click(screen.getByTestId('working-hours-submit'))

    expect(submitWorkingHoursAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitWorkingHoursAction).mock.calls[0][0]).toEqual({
      mon: [{ start: '09:00', end: '17:00' }],
      tue: [{ start: '09:00', end: '17:00' }],
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('validates: half-filled days, end-before-start, and empty weeks never submit', async () => {
    render(<WorkingHoursSettings status={EMPTY} timeZone="America/Los_Angeles" />)

    // Empty week.
    await userEvent.click(screen.getByTestId('working-hours-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one working day/i)

    // Half-filled day.
    await userEvent.type(screen.getByLabelText('Wednesday start'), '09:00')
    await userEvent.click(screen.getByTestId('working-hours-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/both a start and an end/i)

    // End before start.
    await userEvent.type(screen.getByLabelText('Wednesday end'), '08:00')
    await userEvent.click(screen.getByTestId('working-hours-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/end must be after its start/i)

    expect(submitWorkingHoursAction).not.toHaveBeenCalled()
  })

  it('shows the server error verbatim when the submit fails', async () => {
    vi.mocked(submitWorkingHoursAction).mockResolvedValue({
      ok: false,
      error: 'You already have working hours pending review',
    })
    render(<WorkingHoursSettings status={EMPTY} timeZone="America/Los_Angeles" />)

    await userEvent.type(screen.getByLabelText('Monday start'), '09:00')
    await userEvent.type(screen.getByLabelText('Monday end'), '17:00')
    await userEvent.click(screen.getByTestId('working-hours-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have working hours pending review',
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('pending state: read-only schedule behind the review chip, no editor', () => {
    render(
      <WorkingHoursSettings
        status={{ approved: null, pending: { id: 7, schedule: NINE_TO_FIVE, submittedAt: null }, rejected: null }}
        timeZone="America/Los_Angeles"
      />,
    )
    const chip = screen.getByText('Pending review')
    expect(chip.closest('[data-status]')).toHaveAttribute('data-status', 'due_soon')
    expect(screen.getByText(/Changes take effect when approved/)).toBeInTheDocument()
    expect(screen.getByTestId('working-hours-pending')).toHaveTextContent('09:00 - 17:00')
    expect(screen.queryByTestId('working-hours-submit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Monday start')).not.toBeInTheDocument()
  })

  it('approved state: the live schedule is read-only and pre-fills the change editor', () => {
    render(
      <WorkingHoursSettings
        status={{
          approved: { id: 3, schedule: NINE_TO_FIVE, reviewedAt: null, reviewerName: 'Theo Boss' },
          pending: null,
          rejected: null,
        }}
        timeZone="America/Los_Angeles"
      />,
    )
    expect(screen.getByTestId('working-hours-approved')).toHaveTextContent('Theo Boss')
    expect(screen.getByText('Approved schedule')).toBeInTheDocument()
    // The editor pre-fills from the approved schedule.
    expect(screen.getByLabelText('Monday start')).toHaveValue('09:00')
    expect(screen.getByLabelText('Monday end')).toHaveValue('17:00')
    // An off day stays empty.
    expect(screen.getByLabelText('Saturday start')).toHaveValue('')
  })

  it('rejected state: the outcome shows and the rejected schedule pre-fills a resubmit', () => {
    render(
      <WorkingHoursSettings
        status={{
          approved: null,
          pending: null,
          rejected: { id: 4, schedule: NINE_TO_FIVE, reviewedAt: null, reviewerName: 'Theo Boss' },
        }}
        timeZone="America/Los_Angeles"
      />,
    )
    expect(screen.getByTestId('working-hours-rejected')).toHaveTextContent(
      /rejected by Theo Boss/,
    )
    expect(screen.getByLabelText('Monday start')).toHaveValue('09:00')
  })
})
