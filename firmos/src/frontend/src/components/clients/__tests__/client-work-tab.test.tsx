import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { ClientYearGrid } from '@/server/year-grid'

import { ClientWorkTab } from '../client-work-tab'
import { makeCloseSteps, makeWork, makeYearGrid } from './fixtures'

// The Work tab completes rows through this action and refreshes the router
// (same mocks as client-detail-tabs.test.tsx - keep the server DB layer out
// of the jsdom suite).
vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

function renderTab(
  grid: ClientYearGrid = makeYearGrid(),
  seeds: { initialStream?: 'bank_feeds' | 'reconciliations' | 'reports' | 'tasks' | null; initialMonth?: number | null } = {},
) {
  return render(
    <TooltipProvider>
      <ClientWorkTab
        work={makeWork()}
        grid={grid}
        prevYearHref="/clients/1?tab=work&year=2025"
        nextYearHref="/clients/1?tab=work&year=2027"
        initialStream={seeds.initialStream ?? null}
        initialMonth={seeds.initialMonth ?? null}
      />
    </TooltipProvider>,
  )
}

describe('ClientWorkTab deep-link seeds (the drawer step links land here)', () => {
  it('drills the list into the seeded stream + month and anchors the stepper', () => {
    renderTab(makeYearGrid(), { initialStream: 'reports', initialMonth: 7 })
    // The drill-down chip names the stream + period, and the stepper anchors
    // on that month instead of the current work period (Aug).
    expect(screen.getByTestId('year-grid-filter')).toHaveTextContent('Reports · Jul 2026')
    expect(screen.getByRole('heading', { name: 'Close Jul 2026' })).toBeInTheDocument()
  })

  it('seeds the stepper month without a stream filter when only month is given', () => {
    renderTab(makeYearGrid(), { initialMonth: 3 })
    expect(screen.getByRole('heading', { name: 'Close Mar 2026' })).toBeInTheDocument()
    expect(screen.queryByTestId('year-grid-filter')).not.toBeInTheDocument()
  })

  it('no seeds: full list, stepper on the current work period', () => {
    renderTab()
    expect(screen.queryByTestId('year-grid-filter')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Close Aug 2026' })).toBeInTheDocument()
  })

  it('quarterly cadence: a source month seeds the column that covers it', () => {
    // Quarterly grid: 4 columns, each covering three source months.
    const columns = [3, 6, 9, 12].map((month) => ({ year: 2026, month }))
    const covered = (i: number) => [i * 3 + 1, i * 3 + 2, i * 3 + 3]
    const quarterly = makeYearGrid({
      frequency: 'quarterly',
      columns,
      rows: makeYearGrid().rows.map((row) => ({
        ...row,
        cells: columns.map((c, i) => ({ ...row.cells[i], year: 2026, month: c.month, months: covered(i) })),
      })),
      closeSteps: columns.map((c, i) => makeCloseSteps(c.month, { months: covered(i) })),
    })
    renderTab(quarterly, { initialStream: 'reconciliations', initialMonth: 5 })
    // May rolls into the Q2 (June) column.
    expect(screen.getByTestId('year-grid-filter')).toHaveTextContent('Reconciliations · Jun 2026')
    expect(screen.getByRole('heading', { name: 'Close Jun 2026' })).toBeInTheDocument()
  })
})
