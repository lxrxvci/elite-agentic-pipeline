import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { purgeTaskAction, restoreTaskAction } from '@/server/actions/trash'
import type { TrashedTaskItem } from '@/server/trash'

import { TrashBinTable } from '../trash-bin-table'

vi.mock('@/server/actions/trash', () => ({
  restoreTaskAction: vi.fn(),
  purgeTaskAction: vi.fn(),
}))

const mockRestore = vi.mocked(restoreTaskAction)
const mockPurge = vi.mocked(purgeTaskAction)

function item(partial: Partial<TrashedTaskItem>): TrashedTaskItem {
  return {
    id: 1,
    title: 'Categorize July expenses',
    status: 'new',
    clientId: 10,
    clientName: 'Harborline Marine Supply',
    dueDate: '2026-08-20',
    attributedYear: 2026,
    attributedMonth: 8,
    deletedAt: new Date('2026-08-14T10:00:00Z'),
    purgeInDays: 27,
    ...partial,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRestore.mockResolvedValue({ ok: true, data: { restored: true } })
  mockPurge.mockResolvedValue({ ok: true, data: { purged: true } })
})

describe('TrashBinTable', () => {
  it('renders the empty state when the bin is empty', () => {
    render(<TrashBinTable items={[]} />)
    expect(screen.getByText(/the trash is empty/i)).toBeInTheDocument()
  })

  it('lists trashed tasks with client, period chip, and purge countdown', () => {
    render(<TrashBinTable items={[item({})]} />)
    const row = screen.getByTestId('trash-row')
    expect(within(row).getByText('Categorize July expenses')).toBeInTheDocument()
    expect(within(row).getByText('Harborline Marine Supply')).toBeInTheDocument()
    expect(within(row).getByText('Aug 2026')).toBeInTheDocument()
    expect(within(row).getByText('27 days')).toBeInTheDocument()
  })

  it('restores a task and removes the row', async () => {
    render(<TrashBinTable items={[item({ id: 7 })]} />)
    await userEvent.click(screen.getByRole('button', { name: /restore/i }))
    expect(mockRestore).toHaveBeenCalledWith(7)
    expect(await screen.findByText(/the trash is empty/i)).toBeInTheDocument()
  })

  it('keeps the row when restore fails', async () => {
    mockRestore.mockResolvedValue({ ok: false, error: 'That task is not in the trash' })
    render(<TrashBinTable items={[item({ id: 7 })]} />)
    await userEvent.click(screen.getByRole('button', { name: /restore/i }))
    expect(screen.getByTestId('trash-row')).toBeInTheDocument()
  })

  it('arms an inline confirm before permanent delete', async () => {
    render(<TrashBinTable items={[item({ id: 9 })]} />)

    await userEvent.click(screen.getByRole('button', { name: /delete forever/i }))
    expect(mockPurge).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /confirm - irreversible/i }))
    expect(mockPurge).toHaveBeenCalledWith(9)
    expect(await screen.findByText(/the trash is empty/i)).toBeInTheDocument()
  })
})
