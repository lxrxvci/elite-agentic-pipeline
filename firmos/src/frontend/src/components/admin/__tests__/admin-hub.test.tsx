import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AdminHubOverview } from '@/server/admin-reads'

import { AdminHub, relativeLabel } from '../admin-hub'

const NOW = '2026-08-24T15:00:00.000Z'

const OVERVIEW: AdminHubOverview = {
  pendingApprovals: 3,
  unreadClientReplies: 2,
  missingCredentials: 1,
  overdueStatements: 0,
  notClockedInToday: { count: 2, names: ['Jorge Medina', 'Sofia Lindqvist'] },
  jobRuns: [
    { name: 'recurring', lastRanAt: '2026-08-24T12:00:00.000Z' },
    { name: 'missing-info-reminders', lastRanAt: null },
  ],
  recentAudit: [
    {
      id: 91,
      userName: 'Mara Ellison',
      action: 'meeting_created',
      entityType: 'meeting',
      entityId: 7,
      details: {},
      createdAt: new Date('2026-08-24T14:30:00.000Z'),
    },
  ],
}

describe('AdminHub', () => {
  it('renders every stat card linking to its section', () => {
    render(<AdminHub overview={OVERVIEW} nowIso={NOW} />)

    const approvals = screen.getByTestId('admin-hub-approvals')
    expect(approvals).toHaveAttribute('href', '/admin/purgatory')
    expect(approvals).toHaveTextContent('3')

    expect(screen.getByTestId('admin-hub-replies')).toHaveAttribute('href', '/notifications')
    expect(screen.getByTestId('admin-hub-replies')).toHaveTextContent('2')
    expect(screen.getByTestId('admin-hub-credentials')).toHaveAttribute('href', '/clients')
    expect(screen.getByTestId('admin-hub-statements')).toHaveAttribute('href', '/statements')

    const clockin = screen.getByTestId('admin-hub-clockin')
    expect(clockin).toHaveAttribute('href', '/reports/hours')
    expect(clockin).toHaveTextContent('Jorge Medina, Sofia Lindqvist')
  })

  it('lists scheduler stamps with relative times and a never-ran marker', () => {
    render(<AdminHub overview={OVERVIEW} nowIso={NOW} />)
    const jobs = screen.getByTestId('admin-hub-jobs')
    expect(jobs).toHaveTextContent('recurring')
    expect(jobs).toHaveTextContent('3h ago')
    expect(jobs).toHaveTextContent('missing-info-reminders')
    expect(jobs).toHaveTextContent('never ran')
  })

  it('lists recent audit events with relative times', () => {
    render(<AdminHub overview={OVERVIEW} nowIso={NOW} />)
    const audit = screen.getByTestId('admin-hub-audit-list')
    expect(audit).toHaveTextContent('meeting created')
    expect(audit).toHaveTextContent('meeting')
    expect(audit).toHaveTextContent('Mara Ellison')
    expect(audit).toHaveTextContent('30m ago')
  })

  it('renders calm zero states', () => {
    render(
      <AdminHub
        overview={{
          ...OVERVIEW,
          pendingApprovals: 0,
          notClockedInToday: { count: 0, names: [] },
          recentAudit: [],
        }}
        nowIso={NOW}
      />,
    )
    expect(screen.getByTestId('admin-hub-clockin')).toHaveTextContent('Everyone expected today is in')
    expect(screen.getByTestId('admin-hub-audit-list')).toHaveTextContent('No audit events yet.')
  })
})

describe('relativeLabel', () => {
  it('buckets minutes, hours, and days', () => {
    expect(relativeLabel('2026-08-24T14:59:30.000Z', NOW)).toBe('just now')
    expect(relativeLabel('2026-08-24T14:45:00.000Z', NOW)).toBe('15m ago')
    expect(relativeLabel('2026-08-24T05:00:00.000Z', NOW)).toBe('10h ago')
    expect(relativeLabel('2026-08-20T15:00:00.000Z', NOW)).toBe('4d ago')
    expect(relativeLabel('not-a-date', NOW)).toBe('just now')
  })
})
