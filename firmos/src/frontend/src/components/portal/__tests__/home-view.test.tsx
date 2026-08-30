import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PortalHomeView } from '../home-view'
import { makeCloseSteps, makeYearGrid } from '@/components/clients/__tests__/fixtures'
import type { WaitingOnYouItem } from '@/server/portal'
import type { YearGridStream } from '@/server/year-grid'

/** Value copy of the engine's stream order (the module itself is db-backed). */
const ALL_STREAMS: YearGridStream[] = ['bank_feeds', 'reconciliations', 'reports', 'tasks']

/**
 * Portal home (Wave 4 progress parity): the client's own year grid renders
 * read-only with the staff cell language, the current period's close
 * stepper sits above it, the all-done state celebrates "Books closed", and
 * waiting-on-you rows carry kind-colored identity chips.
 */

const waiting: WaitingOnYouItem[] = [
  {
    kind: 'bank_feed',
    id: 11,
    title: 'Bank feed week of 2026-08-17',
    attributedYear: 2026,
    attributedMonth: 8,
    note: 'Waiting on August bank statements from the client.',
    neededFromClient: 'Categorize the highlighted transactions or send the missing bank statement.',
  },
  {
    kind: 'reconciliation',
    id: 12,
    title: 'Reconcile Operating Checking',
    attributedYear: 2026,
    attributedMonth: 7,
    note: null,
    neededFromClient: 'Send the missing statement or answer the open reconciliation questions.',
  },
]

function renderHome(overrides: Partial<Parameters<typeof PortalHomeView>[0]> = {}) {
  return render(
    <PortalHomeView
      firstName="Alison"
      clientName="Harborline Marine Supply"
      waiting={waiting}
      openRequestCount={2}
      recentUploads={[]}
      invoiceCount={1}
      progressGrid={makeYearGrid()}
      progressStreams={ALL_STREAMS}
      {...overrides}
    />,
  )
}

describe('PortalHomeView progress section', () => {
  it('renders the client year grid read-only with the staff cell language', () => {
    renderHome()

    const section = screen.getByTestId('portal-year-progress')
    expect(screen.getByRole('heading', { name: 'Where your books stand' })).toBeInTheDocument()

    // 4 streams x 12 months, every cell an inert labeled element - no buttons.
    const cells = within(section).getAllByTestId('portal-year-grid-cell')
    expect(cells).toHaveLength(48)
    expect(within(section).queryAllByRole('button')).toHaveLength(0)
    for (const cell of cells) expect(cell).toHaveAttribute('data-state')

    // Year navigation.
    expect(screen.getByRole('link', { name: 'Previous year' })).toHaveAttribute(
      'href',
      '/portal?year=2025',
    )
    expect(screen.getByRole('link', { name: 'Next year' })).toHaveAttribute(
      'href',
      '/portal?year=2027',
    )

    // The close stepper for the current period sits above the grid.
    expect(within(section).getByTestId('close-steps')).toBeInTheDocument()
    expect(screen.getByTestId('portal-close-count')).toHaveTextContent('0 of 4 steps done')
  })

  it('hides the tasks row when the account lacks can_view_tasks', () => {
    renderHome({ progressStreams: ALL_STREAMS.filter((s) => s !== 'tasks') })

    const section = screen.getByTestId('portal-year-progress')
    expect(within(section).getAllByTestId('portal-year-grid-cell')).toHaveLength(36)
    expect(within(section).queryByText('Tasks')).not.toBeInTheDocument()
  })

  it('celebrates when the current period close steps are all done', () => {
    const grid = makeYearGrid({
      closeSteps: Array.from({ length: 12 }, (_, i) =>
        makeCloseSteps(
          i + 1,
          {},
          (['categorize', 'reconcile', 'questions', 'reports'] as const).map((key) => ({
            key,
            label: key,
            state: 'complete' as const,
            total: 1,
            completed: 1,
            waiting: 0,
            open: 0,
            overdue: 0,
          })),
        ),
      ),
    })
    renderHome({ progressGrid: grid })

    expect(screen.getByTestId('portal-books-closed')).toHaveTextContent(/Books closed for/)
    expect(screen.queryByTestId('portal-close-count')).not.toBeInTheDocument()
  })
})

describe('PortalHomeView waiting-on-you kind chips', () => {
  it('tags each waiting item with its kind identity and due context', () => {
    renderHome()

    const items = screen.getAllByTestId('waiting-on-you-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('data-kind', 'bank_feed')
    expect(items[0]).toHaveTextContent('Bank feed')
    expect(items[0]).toHaveTextContent('Aug 2026')
    expect(items[1]).toHaveAttribute('data-kind', 'reconciliation')
    expect(items[1]).toHaveTextContent('Reconciliation')
    expect(items[1]).toHaveTextContent('Jul 2026')
    // The status badge survives: kind color means type, not state.
    expect(items[0]).toHaveTextContent('Needs you')
  })
})
