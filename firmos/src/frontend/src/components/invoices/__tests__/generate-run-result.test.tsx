import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { GenerateSummary } from '@/server/invoices'

import { GenerateRunResultCard } from '../generate-run-result'

function summary(partial: Partial<GenerateSummary> = {}): GenerateSummary {
  return {
    year: 2026,
    month: 8,
    invoicesCreated: 5,
    skippedExisting: 2,
    skippedCadence: 1,
    skippedIneligible: 0,
    skippedNoBilling: 1,
    emptySkipped: 3,
    tasksAttached: 4,
    failures: [],
    ...partial,
  }
}

describe('GenerateRunResultCard', () => {
  it('renders created, skipped (all kinds summed), and empty counts with the task note', () => {
    render(<GenerateRunResultCard summary={summary()} onDismiss={() => {}} />)
    const card = screen.getByTestId('generate-run-result')
    expect(card).toHaveTextContent('Aug 2026 billing run complete')

    const created = within(screen.getByTestId('run-created'))
    expect(created.getByText('5')).toBeInTheDocument()
    expect(created.getByText('created')).toBeInTheDocument()

    // skipped = existing 2 + cadence 1 + ineligible 0 + no-billing 1 = 4
    const skipped = within(screen.getByTestId('run-skipped'))
    expect(skipped.getByText('4')).toBeInTheDocument()

    const empty = within(screen.getByTestId('run-empty'))
    expect(empty.getByText('3')).toBeInTheDocument()

    expect(card).toHaveTextContent('4 billable tasks attached')
    expect(screen.queryByTestId('run-failed')).not.toBeInTheDocument()
  })

  it('lists each failed client by name when eight or fewer fail', () => {
    const result = summary({
      failures: [
        { clientId: 1, clientName: 'Harborline Marine Supply', error: 'template missing' },
        { clientId: 2, clientName: 'Blue Spruce Landscaping', error: 'no services' },
      ],
    })
    render(<GenerateRunResultCard summary={result} onDismiss={() => {}} />)
    expect(within(screen.getByTestId('run-failed')).getByText('2')).toBeInTheDocument()
    const list = screen.getByTestId('run-failure-list')
    expect(list).toHaveTextContent('Harborline Marine Supply')
    expect(list).toHaveTextContent('template missing')
    expect(list).toHaveTextContent('Blue Spruce Landscaping')
  })

  it('collapses to a count when more than eight clients fail', () => {
    const failures = Array.from({ length: 9 }, (_, i) => ({
      clientId: i + 1,
      clientName: `Client ${i + 1}`,
      error: 'boom',
    }))
    render(<GenerateRunResultCard summary={summary({ failures })} onDismiss={() => {}} />)
    const list = screen.getByTestId('run-failure-list')
    expect(list).toHaveTextContent('9 clients failed')
    expect(list.querySelectorAll('li')).toHaveLength(0)
  })

  it('dismisses via the close button', async () => {
    const onDismiss = vi.fn()
    render(<GenerateRunResultCard summary={summary()} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss billing run result/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
