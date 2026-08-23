import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusSpine, WorkStatusBadge, type WorkStatus } from './WorkStatusBadge'

const ALL_STATUSES: WorkStatus[] = [
  'overdue',
  'due_soon',
  'on_track',
  'deferred',
  'waiting_client',
  'on_hold',
]

describe('WorkStatusBadge', () => {
  it.each(ALL_STATUSES)('renders the %s status with its default label and data attribute', (status) => {
    render(<WorkStatusBadge status={status} />)
    const badge = screen.getByText(new RegExp(status === 'waiting_client' ? 'Waiting on client' : status.replace('_', ' '), 'i'))
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('data-status', status)
  })

  it('supports a custom label override', () => {
    render(<WorkStatusBadge status="waiting_client" label="With client" />)
    expect(screen.getByText('With client')).toBeInTheDocument()
    expect(screen.queryByText('Waiting on client')).not.toBeInTheDocument()
  })

  it('always pairs color with a text label (never color alone)', () => {
    ALL_STATUSES.forEach((status) => {
      const { unmount } = render(<WorkStatusBadge status={status} />)
      const badge = document.querySelector(`[data-status="${status}"]`)
      expect(badge?.textContent?.length).toBeGreaterThan(0)
      unmount()
    })
  })
})

describe('StatusSpine', () => {
  it('renders a decorative color spine carrying the status', () => {
    const { container } = render(<StatusSpine status="overdue" />)
    const spine = container.querySelector('[data-status="overdue"]')
    expect(spine).not.toBeNull()
    expect(spine).toHaveAttribute('aria-hidden', 'true')
  })
})
