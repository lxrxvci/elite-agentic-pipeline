import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InstitutionSopCoverage } from '../institution-coverage'

vi.mock('@/server/actions/templates', () => ({
  normalizeSopInstitutionKeysAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { normalizeSopInstitutionKeysAction } from '@/server/actions/templates'

const mockBackfill = vi.mocked(normalizeSopInstitutionKeysAction)

const ROWS = [
  { institutionId: 1, name: 'Columbia Bank', accountCount: 4, sopCount: 0, needsSop: true },
  { institutionId: 2, name: 'Chase', accountCount: 3, sopCount: 2, needsSop: false },
  { institutionId: 3, name: 'Umpqua', accountCount: 0, sopCount: 1, needsSop: false },
]

describe('InstitutionSopCoverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flags banks with accounts but no SOPs ("No SOPs yet") and marks covered banks', () => {
    render(<InstitutionSopCoverage rows={ROWS} canEdit={true} />)
    const rows = screen.getAllByTestId('coverage-row')
    expect(rows).toHaveLength(3)
    // The uncovered bank leads the list and carries the flag.
    expect(rows[0]).toHaveTextContent('Columbia Bank')
    expect(rows[0]).toHaveTextContent('4 accounts')
    expect(within(rows[0]).getByTestId('coverage-no-sop')).toHaveTextContent('No SOPs yet')
    // A covered bank shows its SOP count with the green state.
    expect(rows[1]).toHaveTextContent('Chase')
    expect(within(rows[1]).getByTestId('coverage-sop-count')).toHaveTextContent('2 SOPs')
    expect(within(rows[1]).getByText('Covered')).toBeInTheDocument()
    // A bank with SOPs but no accounts still shows up (keyed SOP, no clients).
    expect(rows[2]).toHaveTextContent('Umpqua')
    expect(within(rows[2]).getByTestId('coverage-sop-count')).toHaveTextContent('1 SOP')
  })

  it('empty state when no banks are in use yet', () => {
    render(<InstitutionSopCoverage rows={[]} canEdit={true} />)
    expect(screen.queryByTestId('coverage-row')).not.toBeInTheDocument()
    expect(screen.getByTestId('institution-coverage')).toHaveTextContent(
      'No institutions in use yet',
    )
  })

  it('backfill normalizes legacy SOP keys and reports the result', async () => {
    const user = userEvent.setup()
    mockBackfill.mockResolvedValue({ ok: true, data: { updated: 3 } })
    render(<InstitutionSopCoverage rows={ROWS} canEdit={true} />)
    await user.click(screen.getByTestId('backfill-sop-keys'))
    expect(mockBackfill).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('backfill-sop-keys')).toHaveTextContent('Normalize SOP keys'),
    )
  })

  it('read-only callers (no can_edit_sops) do not see the backfill action', () => {
    render(<InstitutionSopCoverage rows={ROWS} canEdit={false} />)
    expect(screen.queryByTestId('backfill-sop-keys')).not.toBeInTheDocument()
    // The flags still render - coverage is informational for every admin.
    expect(screen.getAllByTestId('coverage-no-sop')).toHaveLength(1)
  })
})
