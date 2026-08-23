import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import { setFeatureFlags } from '@/shared/lib/features'
import { DashboardPage } from './dashboard'

const useTimeEntriesMock = vi.fn()
const useClientsMock = vi.fn()
const useProjectsMock = vi.fn()
vi.mock('@/features/time-entries/api/useTimeEntries', () => ({ useTimeEntries: () => useTimeEntriesMock() }))
vi.mock('@/features/clients/api/useClients', () => ({ useClients: () => useClientsMock() }))
vi.mock('@/features/projects/api/useProjects', () => ({ useProjects: () => useProjectsMock() }))
vi.mock('@/features/time-entries/ui/QuickEntryModal', () => ({
  QuickEntryModal: ({ open }: { open: boolean }) => (open ? <div data-testid="modal-open" /> : null),
}))
vi.mock('@/features/time-entries/ui/LiveTimerPill', () => ({
  LiveTimerPill: () => <div data-testid="live-timer" />,
}))

describe('DashboardPage', () => {
  beforeEach(() => {
    setFeatureFlags({ 'time-capture.quick-entry': true, 'time-capture.live-timer': true })
    useTimeEntriesMock.mockReturnValue({
      data: { items: [{ id: 't1', description: 'Design', duration_minutes: 60, rounded_minutes: 60, status: 'unbilled' }], total: 1 },
      isLoading: false,
    })
    useClientsMock.mockReturnValue({ data: { items: [{ id: 'c1', name: 'Acme' }], total: 1 } })
    useProjectsMock.mockReturnValue({ data: { items: [{ id: 'p1', name: 'Website' }], total: 1 } })
  })

  afterEach(() => {
    setFeatureFlags({})
  })

  it('renders dashboard summary and entries', () => {
    render(<DashboardPage />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByTestId('live-timer')).toBeInTheDocument()
  })

  it('opens quick entry modal', async () => {
    render(<DashboardPage />)
    await userEvent.click(screen.getByRole('button', { name: /log time/i }))
    expect(screen.getByTestId('modal-open')).toBeInTheDocument()
  })
})
