import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { StatementGridCell } from '@/server/statements'

import { StatementCells, StatementGridLegend } from '../statements-grid'

function cell(partial: Partial<StatementGridCell> & Pick<StatementGridCell, 'month' | 'state'>): StatementGridCell {
  return {
    year: 2026,
    releaseDate: `2026-${String(partial.month).padStart(2, '0')}-28`,
    documentId: null,
    fileName: null,
    ...partial,
  }
}

const cells: StatementGridCell[] = [
  cell({ month: 1, state: 'uploaded', documentId: 9, fileName: '013126.pdf' }),
  cell({ month: 2, state: 'missing' }),
  cell({ month: 3, state: 'deferred' }),
  cell({ month: 4, state: 'future' }),
  cell({ month: 5, state: 'before_start' }),
]

describe('StatementCells', () => {
  it('renders one cell per month with the state in data-state and an accessible label', () => {
    render(<StatementCells cells={cells} />)
    const rendered = screen.getAllByTestId('statement-cell')
    expect(rendered).toHaveLength(5)
    expect(rendered.map((c) => c.dataset.state)).toEqual([
      'uploaded',
      'missing',
      'deferred',
      'future',
      'before_start',
    ])
    expect(rendered[0]).toHaveAccessibleName(/Jan 2026: Uploaded/)
    expect(rendered[0]).toHaveAccessibleName(/013126\.pdf/)
    expect(rendered[1]).toHaveAccessibleName(/Feb 2026: Missing/)
    expect(rendered[3]).toHaveAccessibleName(/Apr 2026: Not yet released/)
    expect(rendered[4]).toHaveAccessibleName(/May 2026: Before tracking start/)
  })

  it('fires onCellClick for actionable cells only; before_start stays disabled', async () => {
    const user = userEvent.setup()
    const onCellClick = vi.fn()
    render(<StatementCells cells={cells} onCellClick={onCellClick} />)
    const rendered = screen.getAllByTestId('statement-cell')

    // Even future cells accept an upload (the statement may be in hand early).
    for (const index of [0, 1, 2, 3]) {
      expect(rendered[index]).toBeEnabled()
    }
    expect(rendered[4]).toBeDisabled()

    await user.click(rendered[1])
    expect(onCellClick).toHaveBeenCalledWith(cells[1])
  })

  it('marks the selected cell with aria-pressed', () => {
    render(
      <StatementCells cells={cells} selected={{ year: 2026, month: 2 }} onCellClick={() => {}} />,
    )
    const rendered = screen.getAllByTestId('statement-cell')
    expect(rendered[1]).toHaveAttribute('aria-pressed', 'true')
    expect(rendered[0]).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('StatementGridLegend', () => {
  it('labels every state so color is never the only signal', () => {
    render(<StatementGridLegend />)
    for (const label of ['Uploaded', 'Missing', 'Deferred', 'Not yet released', 'Before tracking start']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
