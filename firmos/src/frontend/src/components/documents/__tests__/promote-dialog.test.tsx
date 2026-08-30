import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { promoteToStatementAction } from '@/server/actions/documents'

import { PromoteDialog } from '../promote-dialog'

vi.mock('@/server/actions/documents', () => ({
  promoteToStatementAction: vi.fn(),
}))

const mockPromote = vi.mocked(promoteToStatementAction)

const accounts = [
  { id: 5, name: 'Operating Checking', institution: 'Chase' },
  { id: 6, name: 'Amex Gold', institution: null },
]

function renderDialog() {
  return render(
    <PromoteDialog
      open
      onOpenChange={() => {}}
      document={{ id: 31, fileName: 'scan-july.pdf' }}
      accounts={accounts}
    />,
  )
}

beforeAll(() => {
  // Radix Select jsdom shims.
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn()
})

beforeEach(() => {
  mockPromote.mockReset()
})

describe('PromoteDialog', () => {
  it('promotes with the chosen account and statement date', async () => {
    const user = userEvent.setup()
    mockPromote.mockResolvedValue({
      ok: true,
      data: {
        result: {
          document: {} as never,
          period: { year: 2026, month: 7 },
          storedPath: 'x/y.pdf',
          updatedInPlace: true,
        },
        status: {
          nextPeriod: null,
          nextStatementDate: null,
          missingCount: 0,
          earliestMissingPeriod: null,
          earliestMissingDate: null,
          deferredUntil: null,
          isDeferred: false,
          isOverdue: false,
        },
      },
    })
    renderDialog()

    await user.click(screen.getByRole('combobox', { name: 'Account' }))
    await user.click(screen.getByRole('option', { name: 'Amex Gold' }))
    await user.type(screen.getByLabelText('Statement date'), '2026-07-31')
    await user.click(screen.getByTestId('promote-submit'))

    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith(31, 6, '2026-07-31', undefined, null),
    )
  })

  it('passes the optional ending balance through to the action', async () => {
    const user = userEvent.setup()
    mockPromote.mockResolvedValue({
      ok: true,
      data: {
        result: {
          document: {} as never,
          period: { year: 2026, month: 7 },
          storedPath: 'x/y.pdf',
          updatedInPlace: true,
        },
        status: {
          nextPeriod: null,
          nextStatementDate: null,
          missingCount: 0,
          earliestMissingPeriod: null,
          earliestMissingDate: null,
          deferredUntil: null,
          isDeferred: false,
          isOverdue: false,
        },
      },
    })
    renderDialog()

    await user.click(screen.getByRole('combobox', { name: 'Account' }))
    await user.click(screen.getByRole('option', { name: 'Amex Gold' }))
    await user.type(screen.getByLabelText('Statement date'), '2026-07-31')
    await user.type(screen.getByLabelText(/Ending balance/), '12408.22')
    await user.click(screen.getByTestId('promote-submit'))

    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith(31, 6, '2026-07-31', undefined, '12408.22'),
    )
  })

  it('shows server errors verbatim', async () => {
    const user = userEvent.setup()
    mockPromote.mockResolvedValue({
      ok: false,
      error: 'A statement already exists for that account and month.',
    })
    renderDialog()

    await user.click(screen.getByRole('combobox', { name: 'Account' }))
    await user.click(screen.getByRole('option', { name: /Operating Checking/ }))
    await user.type(screen.getByLabelText('Statement date'), '2026-07-31')
    await user.click(screen.getByTestId('promote-submit'))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A statement already exists for that account and month.',
      ),
    )
  })

  it('stays disabled until account and date are chosen', () => {
    renderDialog()
    expect(screen.getByTestId('promote-submit')).toBeDisabled()
  })
})
