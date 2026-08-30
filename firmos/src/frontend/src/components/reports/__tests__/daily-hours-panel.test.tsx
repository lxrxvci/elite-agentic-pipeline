import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { getDailyHoursAction } from '@/server/actions/time'
import type { DailyHours } from '@/server/time-tracking'

import { DailyHoursPanel } from '../daily-hours-panel'

vi.mock('@/server/actions/time', () => ({
  getDailyHoursAction: vi.fn(),
}))

const days: DailyHours[] = [
  {
    date: '2026-08-10',
    totalMinutes: 360,
    entries: [
      {
        startedAt: '2026-08-10T09:05:00',
        endedAt: '2026-08-10T10:20:00',
        label: 'reconciliations',
        kind: 'activity',
        clientName: 'Harborline Marine Supply',
      },
      {
        startedAt: '2026-08-10T13:00:00',
        endedAt: '2026-08-10T17:00:00',
        label: 'Categorize Transactions',
        kind: 'task',
        clientName: 'Harborline Marine Supply',
      },
    ],
  },
  {
    date: '2026-08-11',
    totalMinutes: 180,
    entries: [
      {
        startedAt: '2026-08-11T09:00:00',
        endedAt: '2026-08-11T12:00:00',
        label: 'bank_feeds',
        kind: 'activity',
        clientName: null,
      },
    ],
  },
]

async function renderPanel() {
  vi.mocked(getDailyHoursAction).mockResolvedValue({ ok: true, data: days })
  render(<DailyHoursPanel userId={7} fromIso="2026-08-01" toIso="2026-08-15" />)
  await screen.findAllByTestId('daily-hours-day')
}

describe('DailyHoursPanel', () => {
  it('loads days lazily and lists them chronologically with totals', async () => {
    await renderPanel()
    expect(getDailyHoursAction).toHaveBeenCalledWith(7, '2026-08-01', '2026-08-15')

    const dayRows = screen.getAllByTestId('daily-hours-day')
    expect(dayRows.map((r) => r.getAttribute('data-date'))).toEqual(['2026-08-10', '2026-08-11'])
    expect(within(dayRows[0]).getByText(/Aug 10/)).toBeInTheDocument()
    expect(within(dayRows[0]).getByText('6.00 h')).toBeInTheDocument()
    expect(within(dayRows[1]).getByText('3.00 h')).toBeInTheDocument()
  })

  it('expands a day to the worked-on entries, in order, with timestamps', async () => {
    const user = userEvent.setup()
    await renderPanel()

    // Collapsed by default: no entries visible.
    expect(screen.queryAllByTestId('daily-hours-entry')).toHaveLength(0)

    await user.click(screen.getByText(/Aug 10/))
    const entries = screen.getAllByTestId('daily-hours-entry')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('09:05-10:20')
    expect(entries[0]).toHaveTextContent('Reconciliations - Harborline Marine Supply')
    expect(entries[1]).toHaveTextContent('13:00-17:00')
    expect(entries[1]).toHaveTextContent('Categorize Transactions - Harborline Marine Supply')
  })

  it('shows the empty note when the range has no days with hours', async () => {
    vi.mocked(getDailyHoursAction).mockResolvedValue({ ok: true, data: [] })
    render(<DailyHoursPanel userId={7} fromIso="2026-08-01" toIso="2026-08-15" />)
    expect(await screen.findByText('No day-by-day time in this range.')).toBeInTheDocument()
  })

  it('surfaces the action error verbatim', async () => {
    vi.mocked(getDailyHoursAction).mockResolvedValue({ ok: false, error: 'Managers can only view their direct reports' })
    render(<DailyHoursPanel userId={7} fromIso="2026-08-01" toIso="2026-08-15" />)
    expect(
      await screen.findByText('Managers can only view their direct reports'),
    ).toBeInTheDocument()
  })

  it('scales each day mini-bar against the biggest day in the range', async () => {
    await renderPanel()
    const dayRows = screen.getAllByTestId('daily-hours-day')
    // 360 minutes is the max day: full bar. 180 minutes: half.
    expect(within(dayRows[0]).getByTestId('daily-hours-bar')).toHaveStyle({ width: '100%' })
    expect(within(dayRows[1]).getByTestId('daily-hours-bar')).toHaveStyle({ width: '50%' })
    expect(within(dayRows[0]).getByTestId('daily-hours-bar')).toHaveClass('bg-kind-bank-feed')
  })
})
