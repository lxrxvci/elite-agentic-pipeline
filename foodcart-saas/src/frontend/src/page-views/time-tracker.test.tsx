import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import { setFeatureFlags } from '@/shared/lib/features'
import TimeTrackerPage from './time-tracker'

const useTimeEntriesMock = vi.fn()
vi.mock('@/features/time-entries/api/useTimeEntries', () => ({
  useTimeEntries: (options: unknown) => useTimeEntriesMock(options),
}))
vi.mock('@/features/time-entries/ui/QuickEntryModal', () => ({
  QuickEntryModal: ({ open }: { open: boolean }) => (open ? <div data-testid="modal-open" /> : null),
}))

describe('TimeTrackerPage', () => {
  beforeEach(() => {
    setFeatureFlags({ 'time-capture.quick-entry': true })
    useTimeEntriesMock.mockReset()
  })

  it('renders time entries and filters', () => {
    useTimeEntriesMock.mockReturnValue({
      data: {
        items: [
          { id: 't1', description: 'Design', duration_minutes: 60, rounded_minutes: 60, status: 'unbilled' },
        ],
        total: 1,
      },
      isLoading: false,
    })
    render(<TimeTrackerPage />)
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /unbilled/i })).toBeInTheDocument()
  })

  it('switches status filter', async () => {
    useTimeEntriesMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
    render(<TimeTrackerPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Billed' }))
    expect(useTimeEntriesMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'billed' }))
  })

  it('opens quick entry modal', async () => {
    useTimeEntriesMock.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
    render(<TimeTrackerPage />)

    await userEvent.click(screen.getByRole('button', { name: '+ Log time' }))
    expect(screen.getByTestId('modal-open')).toBeInTheDocument()
  })
})
