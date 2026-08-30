import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateMonthlyInvoicesAction } from '@/server/actions/invoices'
import type { GenerateSummary } from '@/server/invoices'

import { GenerateRunButton } from '../generate-run-button'

vi.mock('@/server/actions/invoices', () => ({
  generateMonthlyInvoicesAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockGenerate = vi.mocked(generateMonthlyInvoicesAction)

function summary(partial: Partial<GenerateSummary> = {}): GenerateSummary {
  return {
    year: 2026,
    month: 8,
    invoicesCreated: 5,
    skippedExisting: 1,
    skippedCadence: 0,
    skippedIneligible: 0,
    skippedNoBilling: 0,
    emptySkipped: 0,
    tasksAttached: 3,
    failures: [],
    ...partial,
  }
}

beforeEach(() => {
  mockGenerate.mockReset()
})

describe('GenerateRunButton', () => {
  it('opens a confirm dialog that spells out what the run will do', async () => {
    const user = userEvent.setup()
    render(<GenerateRunButton year={2026} month={8} pendingTaskCount={3} />)
    await user.click(screen.getByTestId('generate-run-button'))

    const dialog = await screen.findByTestId('generate-run-dialog')
    expect(dialog).toHaveTextContent('Generate invoices for Aug 2026?')
    expect(dialog).toHaveTextContent('due Net 15')
    expect(dialog).toHaveTextContent('3 unbilled completed tasks will be attached')
    expect(dialog).toHaveTextContent('skipped, never duplicated')
    expect(dialog).toHaveTextContent('empty are not created')
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('runs the action for the viewed month and hands the summary up for the result card', async () => {
    mockGenerate.mockResolvedValue({ ok: true, data: summary() })
    const { toast } = await import('sonner')
    const onResult = vi.fn()
    const user = userEvent.setup()
    render(
      <GenerateRunButton year={2026} month={8} pendingTaskCount={3} onResult={onResult} />,
    )
    await user.click(screen.getByTestId('generate-run-button'))
    await user.click(await screen.findByRole('button', { name: 'Run for Aug 2026' }))

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith(2026, 8))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(summary()))
    // The visual card replaced the summary toast (Wave 5).
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('toasts the server error verbatim on failure', async () => {
    mockGenerate.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    render(<GenerateRunButton year={2026} month={8} pendingTaskCount={0} />)
    await user.click(screen.getByTestId('generate-run-button'))
    await user.click(await screen.findByRole('button', { name: 'Run for Aug 2026' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to do that.'),
    )
  })
})
