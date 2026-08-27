import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PortalStatementsGrid } from '../statements-grid'
import type { StatementsGrid } from '@/server/statements'

/**
 * Statements grid gating (HANDOFF §12/§14): the five cell states render
 * with labels (never color alone), click-to-upload exists only with
 * can_upload_docs, and the read-only variant (including the CPA surface,
 * which passes canUpload=false everywhere) offers no upload affordance at
 * all.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/portal/statements',
}))

vi.mock('@/server/actions/portal-documents', () => ({
  uploadPortalDocument: vi.fn(),
  uploadPortalStatement: vi.fn(),
}))

const grid: StatementsGrid = {
  clientId: 1,
  today: '2026-08-23',
  accounts: [
    {
      accountId: 11,
      accountName: 'Operating Checking',
      statementDay: 31,
      deferredUntil: null,
      closeDate: null,
      cells: [
        { year: 2026, month: 5, state: 'before_start', releaseDate: '2026-05-31', documentId: null, fileName: null },
        { year: 2026, month: 6, state: 'uploaded', releaseDate: '2026-06-30', documentId: 42, fileName: '063026.pdf' },
        { year: 2026, month: 7, state: 'missing', releaseDate: '2026-07-31', documentId: null, fileName: null },
        { year: 2026, month: 8, state: 'deferred', releaseDate: '2026-08-31', documentId: null, fileName: null },
      ],
    },
    {
      accountId: 12,
      accountName: 'Business Credit Card',
      statementDay: 20,
      deferredUntil: null,
      closeDate: null,
      cells: [
        { year: 2026, month: 7, state: 'missing', releaseDate: '2026-07-20', documentId: null, fileName: null },
        { year: 2026, month: 8, state: 'future', releaseDate: '2026-08-20', documentId: null, fileName: null },
      ],
    },
  ],
}

describe('PortalStatementsGrid', () => {
  it('renders every cell state with a text label and a legend', () => {
    render(<PortalStatementsGrid grid={grid} canUpload={false} />)

    expect(screen.getByLabelText('Jun 2026: Uploaded. Download statement.')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Missing/)).not.toHaveLength(0)
    expect(screen.getByLabelText('Aug 2026: Deferred')).toBeInTheDocument()
    expect(screen.getByLabelText('Aug 2026: Not due yet')).toBeInTheDocument()
    expect(screen.getByLabelText('May 2026: Before start')).toBeInTheDocument()

    const legend = screen.getByRole('list', { name: 'Grid legend' })
    for (const label of ['Uploaded', 'Missing', 'Deferred', 'Not due yet', 'Before start']) {
      expect(legend).toHaveTextContent(label)
    }
  })

  it('uploaded cells download through the portal-scoped API route', () => {
    render(<PortalStatementsGrid grid={grid} canUpload={false} />)
    expect(
      screen.getByRole('link', { name: 'Jun 2026: Uploaded. Download statement.' }),
    ).toHaveAttribute('href', '/api/documents/42')
  })

  it('can_upload_docs on: missing and deferred cells open the upload dialog', async () => {
    const user = userEvent.setup()
    render(<PortalStatementsGrid grid={grid} canUpload />)

    const missingCell = screen.getByTestId('statement-cell-11-2026-7')
    await user.click(missingCell)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Statement date')).toHaveValue('2026-07-31')
    expect(screen.getByLabelText('File')).toBeInTheDocument()
  })

  it('can_upload_docs off: no upload buttons and no file inputs anywhere (CPA read-only path)', () => {
    render(
      <PortalStatementsGrid
        grid={grid}
        canUpload={false}
        readOnlyNote="Statements are read-only for CPA sign-ins."
      />,
    )

    expect(screen.queryByRole('button', { name: /Upload statement/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^statement-cell-/)).not.toBeInTheDocument()
    expect(screen.getByText('Statements are read-only for CPA sign-ins.')).toBeInTheDocument()
    // Inert cells still expose their state accessibly.
    expect(screen.getAllByRole('img', { name: /Missing/ })).not.toHaveLength(0)
  })
})
