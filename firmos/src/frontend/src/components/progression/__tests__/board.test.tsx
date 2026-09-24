import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  FirmProgressionBoard,
  ProgressionCell,
  ProgressionRow,
  ProgressionStreamSummary,
} from '@/server/progression'
import type { YearGridCellState, YearGridStream } from '@/server/year-grid'

import { ProgressionBoard } from '../board'

const dana = { id: 3, name: 'Dana Whitfield', initials: 'DW' }
const jorge = { id: 5, name: 'Jorge Medina', initials: 'JM' }
const sofia = { id: 6, name: 'Sofia Lindqvist', initials: 'SL' }

beforeEach(() => {
  // Radix Select needs these in jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
})

function stream(
  s: YearGridStream,
  state: YearGridCellState,
  counts: Partial<Pick<ProgressionStreamSummary, 'total' | 'completed' | 'waiting' | 'open' | 'overdue'>> = {},
): ProgressionStreamSummary {
  return { stream: s, state, total: 2, completed: 0, waiting: 0, open: 0, overdue: 0, ...counts }
}

function cell(
  month: number,
  state: YearGridCellState,
  opts: { onCadence?: boolean; streams?: ProgressionStreamSummary[] } = {},
): ProgressionCell {
  const onCadence = opts.onCadence ?? true
  const streams =
    opts.streams ??
    (onCadence && state !== 'no_work'
      ? [
          stream('bank_feeds', state, state === 'complete' ? { completed: 2 } : {}),
          stream('reconciliations', state, state === 'complete' ? { completed: 2 } : {}),
          stream('reports', state, { total: 1, completed: state === 'complete' ? 1 : 0 }),
          stream('tasks', state, state === 'complete' ? { completed: 2 } : {}),
        ]
      : [])
  return { month, onCadence, state: onCadence ? state : 'no_work', streams }
}

function makeRow(partial: Partial<ProgressionRow> & Pick<ProgressionRow, 'clientId' | 'name'>): ProgressionRow {
  return {
    legalName: partial.name,
    state: 'active',
    frequency: 'monthly',
    manager: null,
    bookkeeper: null,
    health: { score: 88, status: 'in_progress' },
    streak: 0,
    needsAttention: false,
    cells: Array.from({ length: 12 }, (_, i) => cell(i + 1, 'not_due')),
    ...partial,
  }
}

const harborline = makeRow({
  clientId: 1,
  name: 'Harborline Marine Supply',
  manager: dana,
  bookkeeper: jorge,
  streak: 7,
  cells: [
    ...Array.from({ length: 7 }, (_, i) => cell(i + 1, 'complete')),
    cell(8, 'in_progress', {
      streams: [
        stream('bank_feeds', 'in_progress', { total: 4, completed: 2, open: 2 }),
        stream('reconciliations', 'complete', { total: 1, completed: 1 }),
        stream('reports', 'waiting', { total: 1, waiting: 1 }),
        stream('tasks', 'no_work', { total: 0 }),
      ],
    }),
    ...Array.from({ length: 4 }, (_, i) => cell(i + 9, 'not_due')),
  ],
})

const blueSpruce = makeRow({
  clientId: 2,
  name: 'Blue Spruce Landscaping',
  bookkeeper: sofia,
  health: { score: 60, status: 'overdue' },
  needsAttention: true,
  cells: [
    ...Array.from({ length: 2 }, (_, i) => cell(i + 1, 'complete')),
    cell(3, 'behind', {
      streams: [
        stream('bank_feeds', 'behind', { total: 4, completed: 1, open: 3, overdue: 2 }),
        stream('reconciliations', 'complete', { total: 1, completed: 1 }),
        stream('reports', 'complete', { total: 1, completed: 1 }),
        stream('tasks', 'no_work', { total: 0 }),
      ],
    }),
    ...Array.from({ length: 9 }, (_, i) => cell(i + 4, 'not_due')),
  ],
})

const copperline = makeRow({
  clientId: 3,
  name: 'Copperline Coffee Roasters',
  frequency: 'quarterly',
  manager: dana,
  streak: 2,
  health: { score: 100, status: 'up_to_date' },
  cells: Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    if (![3, 6, 9, 12].includes(month)) return cell(month, 'no_work', { onCadence: false })
    return cell(month, month <= 6 ? 'complete' : 'not_due')
  }),
})

function makeBoard(rows: ProgressionRow[] = [harborline, blueSpruce, copperline]): FirmProgressionBoard {
  return {
    year: 2026,
    today: '2026-08-15',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    rows,
    columnCompletion: [100, 100, 67, 50, 25, 0, 0, 0, 0, 0, 0, null],
  }
}

function renderBoard(board = makeBoard()) {
  return render(
    <TooltipProvider>
      <ProgressionBoard board={board} />
    </TooltipProvider>,
  )
}

async function pickSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerLabel: string,
  option: string,
) {
  await user.click(screen.getByLabelText(triggerLabel))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('ProgressionBoard - the firm heatmap', () => {
  it('renders one row per client with 12 cells, month headers, and year nav', () => {
    renderBoard()
    expect(screen.getAllByTestId('progression-row')).toHaveLength(3)
    for (const row of screen.getAllByTestId('progression-row')) {
      expect(within(row).getAllByTestId('progression-cell')).toHaveLength(12)
    }
    for (const m of ['Jan', 'Mar', 'Jun', 'Sep', 'Dec']) {
      expect(screen.getByText(m)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Previous year')).toHaveAttribute('href', '/progress?year=2025')
    expect(screen.getByLabelText('Next year')).toHaveAttribute('href', '/progress?year=2027')
  })

  it('pairs every cell state with its token classes and an accessible label', () => {
    renderBoard()
    const complete = screen.getByLabelText(/Harborline Marine Supply, Jan 2026: Complete/)
    expect(complete).toHaveAttribute('data-state', 'complete')
    expect(complete.className).toContain('bg-status-on-track-bg')

    const behind = screen.getByLabelText(/Blue Spruce Landscaping, Mar 2026: Behind/)
    expect(behind).toHaveAttribute('data-state', 'behind')
    expect(behind.className).toContain('bg-status-overdue-bg')

    const notDue = screen.getByLabelText(/Harborline Marine Supply, Dec 2026: Not due yet/)
    expect(notDue).toHaveAttribute('data-state', 'not_due')
  })

  it('marks off-cadence months as inert no_work with the cadence explanation', () => {
    renderBoard()
    const offCadence = screen.getByLabelText(
      /Copperline Coffee Roasters, Feb 2026: Quarterly cadence, no period closes this month/,
    )
    expect(offCadence).toHaveAttribute('data-state', 'no_work')
    expect(offCadence.tagName).toBe('SPAN')
  })

  it('opens a detail overlay popover on click instead of navigating away (D12/D9)', async () => {
    const user = userEvent.setup()
    renderBoard()
    const behind = screen.getByLabelText(/Blue Spruce Landscaping, Mar 2026: Behind/)
    // The cell is a button now - the popover owns the detail.
    expect(behind.tagName).toBe('BUTTON')

    await user.click(behind)
    const popover = await screen.findByTestId('cell-popover')
    // Per-kind completion detail: dot/icon + label, never color alone.
    expect(within(popover).getByText('Bank feeds')).toBeInTheDocument()
    expect(within(popover).getByText('1 of 4 done, 2 overdue')).toBeInTheDocument()
    expect(within(popover).getByText('Reconciliations')).toBeInTheDocument()
    // Navigation is still one click away, from inside the overlay.
    const link = within(popover).getByRole('link', { name: /Open Blue Spruce Landscaping.s work tab/ })
    expect(link).toHaveAttribute('href', '/clients/2?tab=work&year=2026')
  })

  it('flags cells with incomplete items (icon marker, not color alone) (D10)', () => {
    renderBoard()
    // Blue Spruce Mar: behind, 3 of 6 incomplete -> flagged, and the
    // accessible name carries the count.
    const behind = screen.getByLabelText(/Blue Spruce Landscaping, Mar 2026: Behind/)
    expect(within(behind).getByTestId('cell-flag')).toBeInTheDocument()
    expect(behind.getAttribute('aria-label')).toContain('3 items incomplete')

    // Harborline Aug: in progress, 3 of 6 incomplete -> flagged.
    const inProgress = screen.getByLabelText(/Harborline Marine Supply, Aug 2026: In progress/)
    expect(within(inProgress).getByTestId('cell-flag')).toBeInTheDocument()

    // Complete and not-due cells never flag.
    const complete = screen.getByLabelText(/Harborline Marine Supply, Jan 2026: Complete/)
    expect(within(complete).queryByTestId('cell-flag')).not.toBeInTheDocument()
    const notDue = screen.getByLabelText(/Harborline Marine Supply, Dec 2026: Not due yet/)
    expect(within(notDue).queryByTestId('cell-flag')).not.toBeInTheDocument()
  })

  it('expand-all unfolds the four stream rows per client; collapse restores (D9)', async () => {
    const user = userEvent.setup()
    renderBoard()
    expect(screen.queryAllByTestId('stream-row')).toHaveLength(0)

    const toggle = screen.getByTestId('expand-all-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // 3 clients x 4 streams, in stream order under each row.
    const streamRows = screen.getAllByTestId('stream-row')
    expect(streamRows).toHaveLength(12)
    expect(streamRows.slice(0, 4).map((r) => r.getAttribute('data-stream'))).toEqual([
      'bank_feeds',
      'reconciliations',
      'reports',
      'tasks',
    ])

    // A stream sub-cell carries the same state language + flag rule.
    const behindStreamCell = screen.getByLabelText(
      /Blue Spruce Landscaping Bank feeds, Mar 2026: Behind/,
    )
    expect(behindStreamCell).toHaveAttribute('data-state', 'behind')
    expect(within(behindStreamCell).getByTestId('cell-flag')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.queryAllByTestId('stream-row')).toHaveLength(0)
  })

  it('renders the firm completion footer per month, with a dot when nothing is attributed', () => {
    renderBoard()
    const footer = screen.getAllByTestId('column-completion')
    expect(footer).toHaveLength(12)
    expect(footer[0]).toHaveTextContent('100%')
    expect(footer[2]).toHaveTextContent('67%')
    expect(footer[11]).toHaveTextContent('·')
    expect(screen.getByText('Firm completion')).toBeInTheDocument()
  })

  it('shows the close streak badge only at three or more', () => {
    renderBoard()
    const harbor = screen
      .getAllByTestId('progression-row')
      .find((r) => r.textContent?.includes('Harborline'))!
    expect(within(harbor).getByTestId('streak-badge')).toHaveTextContent('7 in a row')

    const copper = screen
      .getAllByTestId('progression-row')
      .find((r) => r.textContent?.includes('Copperline'))!
    expect(within(copper).queryByTestId('streak-badge')).not.toBeInTheDocument()
  })

  it('filters to rows that need attention', async () => {
    const user = userEvent.setup()
    renderBoard()
    expect(screen.getByText(/need attention/)).toBeInTheDocument()

    await user.click(screen.getByTestId('needs-attention-toggle'))
    const rows = screen.getAllByTestId('progression-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Blue Spruce')

    await user.click(screen.getByTestId('needs-attention-toggle'))
    expect(screen.getAllByTestId('progression-row')).toHaveLength(3)
  })

  it('filters by cadence and by team member', async () => {
    const user = userEvent.setup()
    renderBoard()

    await pickSelectOption(user, 'Filter by cadence', 'Quarterly')
    expect(screen.getAllByTestId('progression-row')).toHaveLength(1)
    expect(screen.getByText('Copperline Coffee Roasters')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getAllByTestId('progression-row')).toHaveLength(3)

    await pickSelectOption(user, 'Filter by team member', 'Sofia Lindqvist')
    const rows = screen.getAllByTestId('progression-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Blue Spruce')
  })

  it('says so when filters match no one, and clears back', async () => {
    const user = userEvent.setup()
    renderBoard()
    await pickSelectOption(user, 'Filter by cadence', 'Quarterly')
    await user.click(screen.getByTestId('needs-attention-toggle'))
    expect(screen.queryAllByTestId('progression-row')).toHaveLength(0)
    expect(screen.getByText('No clients match these filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByTestId('progression-row')).toHaveLength(3)
  })

  it('renders the six-state legend so color is never the only signal', () => {
    renderBoard()
    for (const label of ['Complete', 'In progress', 'Behind', 'Waiting on client', 'Not due yet', 'No work']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('renders the empty state when no client counts for scoring', () => {
    renderBoard(makeBoard([]))
    expect(screen.getByText('No clients on the board yet')).toBeInTheDocument()
    expect(screen.queryByTestId('progression-board')).not.toBeInTheDocument()
  })
})
