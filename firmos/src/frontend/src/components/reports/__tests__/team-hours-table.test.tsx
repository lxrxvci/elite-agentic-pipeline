import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { UserHoursReport } from '@/server/time-tracking'

import { TeamHoursTable } from '../team-hours-table'

/**
 * Team hours table: D11 column sorting (asc/desc cycling with aria-sort);
 * the team-total row stays pinned at the bottom in every sort order.
 */

// The expanded row's DailyHoursPanel fetches; never expanded in these tests.
vi.mock('../daily-hours-panel', () => ({
  DailyHoursPanel: () => null,
}))

function user(partial: Partial<UserHoursReport> & Pick<UserHoursReport, 'userId' | 'userName'>): UserHoursReport {
  return {
    role: 'bookkeeper',
    totalMinutes: 600,
    dayMinutes: 480,
    activityMinutes: 300,
    taskMinutes: 120,
    generalMinutes: 60,
    billableMinutes: 90,
    unbillableMinutes: 510,
    byActivityType: {},
    byClient: [],
    ...partial,
  }
}

const USERS: UserHoursReport[] = [
  user({ userId: 1, userName: 'Sofia Lindqvist', totalMinutes: 300 }),
  user({ userId: 2, userName: 'Jorge Medina', totalMinutes: 900 }),
  user({ userId: 3, userName: 'Priya Nair', totalMinutes: 600 }),
]

const names = () =>
  screen
    .getAllByTestId('team-hours-row')
    .map((r) => r.textContent ?? '')

describe('TeamHoursTable sorting (D11)', () => {
  it('defaults to name ascending and keeps the total row pinned last', () => {
    render(<TeamHoursTable users={USERS} fromIso="2026-08-01" toIso="2026-08-15" />)
    expect(names()[0]).toContain('Jorge Medina')
    expect(names()[1]).toContain('Priya Nair')
    expect(names()[2]).toContain('Sofia Lindqvist')
    // Pinned totals row after every row, any sort.
    const total = screen.getByTestId('team-hours-total')
    expect(total.compareDocumentPosition(screen.getAllByTestId('team-hours-row')[0])).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it('sorts numeric columns desc on first click, asc on second', async () => {
    const user2 = userEvent.setup()
    render(<TeamHoursTable users={USERS} fromIso="2026-08-01" toIso="2026-08-15" />)

    await user2.click(screen.getByTestId('sort-totalMinutes'))
    const head = screen.getByTestId('sort-totalMinutes').closest('th')
    expect(head).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toContain('Jorge Medina') // 900
    expect(names()[2]).toContain('Sofia Lindqvist') // 300

    await user2.click(screen.getByTestId('sort-totalMinutes'))
    expect(head).toHaveAttribute('aria-sort', 'ascending')
    expect(names()[0]).toContain('Sofia Lindqvist')
  })

  it('name sorting flips to descending on repeat click', async () => {
    const user2 = userEvent.setup()
    render(<TeamHoursTable users={USERS} fromIso="2026-08-01" toIso="2026-08-15" />)
    const head = screen.getByTestId('sort-name').closest('th')
    expect(head).toHaveAttribute('aria-sort', 'ascending')
    await user2.click(screen.getByTestId('sort-name'))
    expect(head).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toContain('Sofia Lindqvist')
  })
})
