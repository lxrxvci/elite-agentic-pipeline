import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { WorkCard } from '@/server/queue'
import type { ClientYearGrid, YearGridCell, YearGridCellState, YearGridStream } from '@/server/year-grid'

import { ClientWorkTab } from '../client-work-tab'
import { YearGrid, YearGridLegend } from '../year-grid'
import { makeWork, makeYearGrid } from './fixtures'

// The work tab completes rows through this action (server-only import chain)
// and refreshes via the app router; both are mocked so jsdom stays offline.
const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))
vi.mock('@/server/actions/work', () => ({
  completeWorkCard: vi.fn().mockResolvedValue({ ok: true }),
}))

function cell(
  stream: YearGridStream,
  month: number,
  state: YearGridCellState,
  counts: Partial<Pick<YearGridCell, 'total' | 'completed' | 'waiting' | 'open' | 'overdue'>> = {},
  months: number[] = [month],
): YearGridCell {
  return {
    stream,
    year: 2026,
    month,
    months,
    state,
    total: 0,
    completed: 0,
    waiting: 0,
    open: 0,
    overdue: 0,
    ...counts,
  }
}

function renderGrid({
  grid = makeYearGrid(),
  filter = null,
  onCellClick = () => {},
}: Partial<{
  grid: ClientYearGrid
  filter: Parameters<typeof YearGrid>[0]['filter']
  onCellClick: (f: Parameters<typeof YearGrid>[0]['filter']) => void
}> = {}) {
  return render(
    <TooltipProvider>
      <YearGrid
        grid={grid}
        filter={filter}
        onCellClick={onCellClick}
        prevYearHref="/clients/1?tab=work&year=2025"
        nextYearHref="/clients/1?tab=work&year=2027"
      />
    </TooltipProvider>,
  )
}

describe('YearGrid render matrix', () => {
  const matrix: Array<[YearGridCellState, YearGridCell, RegExp]> = [
    ['complete', cell('bank_feeds', 1, 'complete', { total: 4, completed: 4 }), /Bank feeds, Jan 2026: Complete, 4 of 4 feeds done/],
    ['in_progress', cell('bank_feeds', 2, 'in_progress', { total: 4, completed: 2, open: 2 }), /Bank feeds, Feb 2026: In progress, 2 of 4 feeds done/],
    ['behind', cell('bank_feeds', 3, 'behind', { total: 4, completed: 1, open: 3, overdue: 2 }), /Bank feeds, Mar 2026: Behind, 1 of 4 feeds done, 2 overdue/],
    ['waiting', cell('bank_feeds', 4, 'waiting', { total: 2, waiting: 2 }), /Bank feeds, Apr 2026: Waiting on client, 0 of 2 feeds done, 2 waiting on client/],
    ['not_due', cell('bank_feeds', 5, 'not_due'), /Bank feeds, May 2026: Not due yet/],
    ['no_work', cell('bank_feeds', 6, 'no_work'), /Bank feeds, Jun 2026: No work/],
  ]

  it('pairs every state with its token classes, an icon, and an accessible counts label', () => {
    const grid = makeYearGrid({
      rows: [
        { stream: 'bank_feeds', cells: matrix.map(([, c]) => c) },
        ...makeYearGrid().rows.filter((r) => r.stream !== 'bank_feeds'),
      ],
    })
    renderGrid({ grid })

    for (const [state, c, label] of matrix) {
      const el = screen.getByLabelText(label)
      expect(el).toHaveAttribute('data-state', state)
      expect(el).toHaveAttribute('data-stream', 'bank_feeds')
      expect(el).toHaveAttribute('data-month', `2026-${c.month}`)
    }
  })

  it('renders one cell per stream x column, with stream row labels', () => {
    renderGrid()
    expect(screen.getAllByTestId('year-grid-cell')).toHaveLength(48)
    for (const label of ['Bank feeds', 'Reconciliations', 'Reports', 'Tasks']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Dec')).toBeInTheDocument()
  })

  it('no_work cells are disabled; every other state is clickable', () => {
    const grid = makeYearGrid({
      rows: [
        { stream: 'bank_feeds', cells: [cell('bank_feeds', 1, 'no_work'), cell('bank_feeds', 2, 'not_due')] },
        ...makeYearGrid().rows.filter((r) => r.stream !== 'bank_feeds'),
      ],
    })
    renderGrid({ grid })
    const cells = screen.getAllByTestId('year-grid-cell')
    expect(cells[0]).toBeDisabled()
    expect(cells[1]).toBeEnabled()
  })

  it('shows only the cadence columns for quarterly clients', () => {
    const quarterly = makeYearGrid({
      frequency: 'quarterly',
      columns: [3, 6, 9, 12].map((month) => ({ year: 2026, month })),
      rows: (['bank_feeds', 'reconciliations', 'reports', 'tasks'] as YearGridStream[]).map(
        (stream) => ({
          stream,
          cells: [3, 6, 9, 12].map((month) =>
            cell(stream, month, 'not_due', {}, month === 3 ? [1, 2, 3] : month === 6 ? [4, 5, 6] : month === 9 ? [7, 8, 9] : [10, 11, 12]),
          ),
        }),
      ),
    })
    renderGrid({ grid: quarterly })
    expect(screen.getAllByTestId('year-grid-cell')).toHaveLength(16)
    for (const m of ['Mar', 'Jun', 'Sep', 'Dec']) {
      expect(screen.getByText(m)).toBeInTheDocument()
    }
    expect(screen.queryByText('Jan')).not.toBeInTheDocument()
  })

  it('surfaces the on-hold note instead of scoring', () => {
    renderGrid({
      grid: makeYearGrid({
        onHold: true,
        note: 'Client is paused. The grid is frozen: nothing accrues and nothing counts while paused.',
      }),
    })
    expect(screen.getByTestId('year-grid-note')).toHaveTextContent(/paused/i)
  })

  it('navigates years through the prev/next links', () => {
    renderGrid()
    expect(screen.getByLabelText('Previous year')).toHaveAttribute('href', '/clients/1?tab=work&year=2025')
    expect(screen.getByLabelText('Next year')).toHaveAttribute('href', '/clients/1?tab=work&year=2027')
  })
})

describe('YearGrid drill-down', () => {
  it('clicking a cell emits its stream, column, and covered months; clicking again clears', async () => {
    const user = userEvent.setup()
    const onCellClick = vi.fn()
    const grid = makeYearGrid({
      rows: [
        { stream: 'reports', cells: [cell('reports', 3, 'behind', { total: 1, open: 1, overdue: 1 }, [1, 2, 3])] },
        ...makeYearGrid().rows.filter((r) => r.stream !== 'reports'),
      ],
    })
    const { rerender } = render(
      <TooltipProvider>
        <YearGrid
          grid={grid}
          filter={null}
          onCellClick={onCellClick}
          prevYearHref="#"
          nextYearHref="#"
        />
      </TooltipProvider>,
    )

    await user.click(screen.getByLabelText(/Reports, Mar 2026/))
    expect(onCellClick).toHaveBeenCalledWith({
      kind: 'report',
      stream: 'reports',
      year: 2026,
      month: 3,
      months: [1, 2, 3],
      label: 'Reports · Mar 2026',
    })

    const filter = onCellClick.mock.calls[0][0]
    rerender(
      <TooltipProvider>
        <YearGrid
          grid={grid}
          filter={filter}
          onCellClick={onCellClick}
          prevYearHref="#"
          nextYearHref="#"
        />
      </TooltipProvider>,
    )
    const selected = screen.getByLabelText(/Reports, Mar 2026/)
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    await user.click(selected)
    expect(onCellClick).toHaveBeenLastCalledWith(null)
  })
})

describe('YearGridLegend', () => {
  it('labels all six states so color is never the only signal', () => {
    render(<YearGridLegend />)
    for (const label of ['Complete', 'In progress', 'Behind', 'Waiting on client', 'Not due yet', 'No work']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})

describe('ClientWorkTab', () => {
  const workCard = (partial: Partial<WorkCard> & Pick<WorkCard, 'kind' | 'id'>): WorkCard => ({
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: `${partial.kind} ${partial.id}`,
    attributedYear: 2026,
    attributedMonth: 8,
    dueDate: '2026-08-20',
    assigneeId: 5,
    status: 'overdue',
    waitingOnClient: false,
    deferredUntil: null,
    ...partial,
  })

  function renderTab({
    grid = makeYearGrid(),
    work = makeWork({
      rows: [
        workCard({ kind: 'bank_feed', id: 1, title: 'Feed week A' }),
        workCard({ kind: 'bank_feed', id: 2, title: 'Feed week B' }),
        workCard({ kind: 'reconciliation', id: 3, title: 'Reconcile July', attributedMonth: 7 }),
      ],
    }),
  }: Partial<{ grid: ClientYearGrid; work: ReturnType<typeof makeWork> }> = {}) {
    return render(
      <TooltipProvider>
        <ClientWorkTab
          work={work}
          grid={grid}
          prevYearHref="#"
          nextYearHref="#"
        />
      </TooltipProvider>,
    )
  }

  it('renders the grid above the full work list by default', () => {
    renderTab()
    expect(screen.getByTestId('year-grid')).toBeInTheDocument()
    expect(screen.getAllByTestId('client-work-row')).toHaveLength(3)
    expect(screen.queryByTestId('year-grid-filter')).not.toBeInTheDocument()
  })

  it('filters the work list to the clicked cell and clears back', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByLabelText(/Bank feeds, Aug 2026/))
    expect(screen.getByTestId('year-grid-filter')).toHaveTextContent('Bank feeds · Aug 2026')
    expect(screen.getByTestId('year-grid-filter')).toHaveTextContent('2 of 3 open')
    expect(screen.getAllByTestId('client-work-row')).toHaveLength(2)
    expect(screen.queryByText('Reconcile July')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Clear period filter'))
    expect(screen.getAllByTestId('client-work-row')).toHaveLength(3)
    expect(screen.queryByTestId('year-grid-filter')).not.toBeInTheDocument()
  })

  it('drills a quarterly column into all of its covered months', async () => {
    const user = userEvent.setup()
    const quarterlyGrid = makeYearGrid({
      frequency: 'quarterly',
      columns: [{ year: 2026, month: 3 }],
      rows: [
        { stream: 'reconciliations', cells: [cell('reconciliations', 3, 'in_progress', { total: 3, completed: 1, open: 2 }, [1, 2, 3])] },
      ],
    })
    renderTab({
      grid: quarterlyGrid,
      work: makeWork({
        rows: [
          workCard({ kind: 'reconciliation', id: 11, title: 'Reconcile Jan', attributedMonth: 1 }),
          workCard({ kind: 'reconciliation', id: 12, title: 'Reconcile Feb', attributedMonth: 2 }),
          workCard({ kind: 'report', id: 13, title: 'Q1 package', attributedMonth: 3 }),
        ],
      }),
    })

    await user.click(screen.getByLabelText(/Reconciliations, Mar 2026/))
    const rows = screen.getAllByTestId('client-work-row')
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Reconcile Jan')).toBeInTheDocument()
    expect(screen.getByText('Reconcile Feb')).toBeInTheDocument()
    expect(screen.queryByText('Q1 package')).not.toBeInTheDocument()
  })

  it('says so when the drilled cell has no open work', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByLabelText(/Tasks, Aug 2026/))
    expect(screen.getByTestId('year-grid-filter-empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('client-work-row')).toHaveLength(0)
  })

  it('keeps the explanatory empty state under the grid when there is no work at all', () => {
    renderTab({ work: makeWork({ state: 'paused', rows: [] }) })
    expect(screen.getByTestId('year-grid')).toBeInTheDocument()
    expect(screen.getByText('Client is paused')).toBeInTheDocument()
  })

  it('completes a row optimistically, then refreshes so the grid can flip green', async () => {
    const user = userEvent.setup()
    const { completeWorkCard } = await import('@/server/actions/work')
    renderTab()

    await user.click(screen.getByLabelText('Complete: Reconcile July'))
    expect(completeWorkCard).toHaveBeenCalledWith({ kind: 'reconciliation', id: 3 }, true)
    // Optimistic: the row leaves the list before the server round-trip lands.
    expect(screen.queryByText('Reconcile July')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('client-work-row')).toHaveLength(2)
    expect(refreshMock).toHaveBeenCalled()
  })
})

describe('YearGrid completion glow', () => {
  it('pulses a green glow once when a mounted cell flips to complete, never on first paint', () => {
    const base = makeYearGrid()
    const flipped = makeYearGrid({
      rows: base.rows.map((r) =>
        r.stream === 'bank_feeds'
          ? {
              ...r,
              cells: r.cells.map((c) =>
                c.month === 8 ? { ...c, state: 'complete' as const, total: 4, completed: 4 } : c,
              ),
            }
          : r,
      ),
    })
    const props = {
      filter: null,
      onCellClick: () => {},
      prevYearHref: '#',
      nextYearHref: '#',
    }
    const { rerender } = render(
      <TooltipProvider>
        <YearGrid grid={base} {...props} />
      </TooltipProvider>,
    )
    const cell = screen.getByLabelText(/Bank feeds, Aug 2026/)
    // First paint never celebrates, even for cells already complete.
    expect(cell.className).not.toContain('motion-safe:shadow-')

    rerender(
      <TooltipProvider>
        <YearGrid grid={flipped} {...props} />
      </TooltipProvider>,
    )
    // The flip pulse: glow ring + brightness lift, reduced-motion gated.
    expect(cell.className).toContain('motion-safe:shadow-[0_0_0_2px_var(--status-on-track),0_0_14px_var(--status-on-track)]')
    expect(cell.className).toContain('motion-safe:brightness-110')
  })
})
