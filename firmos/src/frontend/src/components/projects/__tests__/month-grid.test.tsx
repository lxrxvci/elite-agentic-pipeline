import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MonthGrid } from '../month-grid'
import type { ProjectPeriodCell } from '@/server/projects'

// The grid calls the period-toggle server action; mocking keeps jsdom off
// the DB layer.
vi.mock('@/server/actions/projects', () => ({
  setProjectTaskPeriodAction: vi.fn().mockResolvedValue({ ok: true, data: { projectId: 1, projectStatus: 'in_progress', rowCompleted: false } }),
}))

import { setProjectTaskPeriodAction } from '@/server/actions/projects'

function periods(year: number, completedMonths: number[]): ProjectPeriodCell[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const completed = completedMonths.includes(month)
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      year,
      month,
      completed,
      completedByName: completed ? 'Dana Cole' : null,
    }
  })
}

describe('MonthGrid (HANDOFF §20)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders twelve cells with per-period completion state', () => {
    render(<MonthGrid taskId={7} periods={periods(2026, [1, 2])} />)
    const cells = screen.getAllByTestId('month-cell')
    expect(cells).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Jan 2026: complete' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mar 2026: mark complete' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a cell toggles that period through the server action', async () => {
    const user = userEvent.setup()
    render(<MonthGrid taskId={7} periods={periods(2026, [1])} />)
    await user.click(screen.getByRole('button', { name: 'Jun 2026: mark complete' }))
    expect(setProjectTaskPeriodAction).toHaveBeenCalledWith(7, 2026, 6, true)
  })

  it('clicking a completed cell re-opens that period', async () => {
    const user = userEvent.setup()
    render(<MonthGrid taskId={7} periods={periods(2026, [1])} />)
    await user.click(screen.getByRole('button', { name: 'Jan 2026: complete' }))
    expect(setProjectTaskPeriodAction).toHaveBeenCalledWith(7, 2026, 1, false)
  })

  it('freezes the grid when disabled (cancelled project)', () => {
    render(<MonthGrid taskId={7} periods={periods(2026, [])} disabled />)
    for (const cell of screen.getAllByTestId('month-cell')) {
      expect(cell).toBeDisabled()
    }
  })
})
