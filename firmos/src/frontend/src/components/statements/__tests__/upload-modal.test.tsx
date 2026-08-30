import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadStatementAction } from '@/server/actions/documents'
import type { StatementGridCell, StatementStatus } from '@/server/statements'

import { StatementUploadModal, type UploadModalAccount } from '../upload-modal'

vi.mock('@/server/actions/documents', () => ({
  uploadStatementAction: vi.fn(),
}))

const mockUpload = vi.mocked(uploadStatementAction)

function cell(month: number, state: StatementGridCell['state']): StatementGridCell {
  return {
    year: 2026,
    month,
    state,
    releaseDate: `2026-${String(month).padStart(2, '0')}-28`,
    documentId: null,
    fileName: null,
    endingBalance: null,
    statementDate: null,
  }
}

const account: UploadModalAccount = {
  accountId: 42,
  accountName: 'Operating Checking',
  clientName: 'Harborline Marine Supply',
  cells: [cell(1, 'uploaded'), cell(2, 'missing'), cell(3, 'future')],
}

const freshStatus: StatementStatus = {
  nextPeriod: { year: 2026, month: 3 },
  nextStatementDate: '2026-03-28',
  missingCount: 0,
  earliestMissingPeriod: null,
  earliestMissingDate: null,
  deferredUntil: null,
  isDeferred: false,
  isOverdue: false,
}

function renderModal(onUploaded = vi.fn()) {
  return {
    onUploaded,
    ...render(
      <StatementUploadModal open onOpenChange={() => {}} account={account} onUploaded={onUploaded} />,
    ),
  }
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('Choose statement file')
  const file = new File(['%PDF-1.4 fake'], 'feb-statement.pdf', { type: 'application/pdf' })
  await user.upload(input, file)
}

beforeEach(() => {
  mockUpload.mockReset()
})

describe('StatementUploadModal', () => {
  it('preselects the first missing cell and seeds its release date', () => {
    renderModal()
    const cells = screen.getAllByTestId('statement-cell')
    expect(cells[1]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Statement date')).toHaveValue('2026-02-28')
  })

  it('clicking a different cell retargets the period and date', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getAllByTestId('statement-cell')[2])
    expect(screen.getByLabelText('Statement date')).toHaveValue('2026-03-28')
  })

  it('uploads with the clicked period as the explicit hint and shows the server attribution', async () => {
    const user = userEvent.setup()
    const onUploaded = vi.fn()
    mockUpload.mockResolvedValue({
      ok: true,
      data: {
        result: {
          document: {} as never,
          // The server attributed to March even though February was clicked:
          // the UI must show the resolved period, not the guess.
          period: { year: 2026, month: 3 },
          storedPath: 'x/y.pdf',
          updatedInPlace: false,
        },
        status: freshStatus,
      },
    })

    renderModal(onUploaded)
    await chooseFile(user)
    await user.click(screen.getByTestId('upload-submit'))

    await waitFor(() => expect(screen.getByTestId('upload-success')).toBeInTheDocument())
    expect(mockUpload).toHaveBeenCalledTimes(1)
    const formData = mockUpload.mock.calls[0][0]
    expect(formData.get('accountId')).toBe('42')
    expect(formData.get('statementDate')).toBe('2026-02-28')
    expect(formData.get('explicitYear')).toBe('2026')
    expect(formData.get('explicitMonth')).toBe('2')
    expect(formData.get('file')).toBeInstanceOf(File)

    expect(screen.getByText(/Attributed to Mar 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Next: Mar 2026 statement/)).toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledWith(freshStatus)
  })

  it('sends the optional ending balance with the upload', async () => {
    const user = userEvent.setup()
    mockUpload.mockResolvedValue({
      ok: true,
      data: {
        result: {
          document: {} as never,
          period: { year: 2026, month: 2 },
          storedPath: 'x/y.pdf',
          updatedInPlace: false,
        },
        status: freshStatus,
      },
    })

    renderModal()
    await chooseFile(user)
    await user.type(screen.getByLabelText(/Ending balance/), '12408.22')
    await user.click(screen.getByTestId('upload-submit'))

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(mockUpload.mock.calls[0][0].get('endingBalance')).toBe('12408.22')
  })

  it('omits the ending balance field when left blank', async () => {
    const user = userEvent.setup()
    mockUpload.mockResolvedValue({
      ok: true,
      data: {
        result: {
          document: {} as never,
          period: { year: 2026, month: 2 },
          storedPath: 'x/y.pdf',
          updatedInPlace: false,
        },
        status: freshStatus,
      },
    })

    renderModal()
    await chooseFile(user)
    await user.click(screen.getByTestId('upload-submit'))

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(mockUpload.mock.calls[0][0].get('endingBalance')).toBeNull()
  })

  it('shows server validation errors verbatim', async () => {
    const user = userEvent.setup()
    mockUpload.mockResolvedValue({ ok: false, error: 'That file type is not allowed.' })
    renderModal()
    await chooseFile(user)
    await user.click(screen.getByTestId('upload-submit'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That file type is not allowed.'))
    expect(screen.queryByTestId('upload-success')).not.toBeInTheDocument()
  })

  it('keeps the submit disabled until a file and date are present', () => {
    renderModal()
    expect(screen.getByTestId('upload-submit')).toBeDisabled()
  })
})
