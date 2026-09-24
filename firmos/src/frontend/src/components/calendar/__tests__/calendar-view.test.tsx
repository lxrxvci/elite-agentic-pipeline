import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarDayItems } from '@/server/calendar'
import {
  deleteMeetingAction,
  emailMeetingInfoAction,
  getCalendarDayAction,
} from '@/server/actions/calendar'

import { CalendarViewRoot } from '../calendar-view'

vi.mock('@/server/actions/calendar', () => ({
  createMeetingAction: vi.fn(),
  updateMeetingAction: vi.fn(),
  deleteMeetingAction: vi.fn(),
  emailMeetingInfoAction: vi.fn(),
  getCalendarDayAction: vi.fn(),
}))

const mockGetDay = vi.mocked(getCalendarDayAction)
const mockEmail = vi.mocked(emailMeetingInfoAction)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const CLIENTS = [
  { id: 1, name: 'Harborline Marine Supply' },
  { id: 2, name: 'Blue Spruce Landscaping' },
]

function emptyDay(iso: string): CalendarDayItems {
  return { date: iso, workItems: [], meetings: [] }
}

/** Sunday-start grid days for August 2026 (Aug 1 is a Saturday). */
function augustGrid(): CalendarDayItems[] {
  const days: CalendarDayItems[] = []
  const start = new Date(Date.UTC(2026, 6, 26))
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000)
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    days.push(emptyDay(iso))
  }
  const aug12 = days.find((d) => d.date === '2026-08-12')!
  aug12.workItems.push({
    kind: 'task',
    id: 41,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: 'Reconcile fixture',
    dueDate: '2026-08-12',
    assigneeName: 'Jorge Medina',
  })
  aug12.meetings.push({
    id: 7,
    clientId: 1,
    clientName: 'Harborline Marine Supply',
    title: 'August close review',
    startsAt: '2026-08-12T17:00:00.000Z',
    endsAt: '2026-08-12T17:30:00.000Z',
    startLabel: '1:00 PM',
    endLabel: '1:30 PM',
    link: 'https://meet.google.com/abc-defg-hij',
    location: null,
    notes: null,
    billable: true,
    amount: null,
    billedInvoiceId: null,
    createdByName: 'Mara Ellison',
  })
  return days
}

const AUGUST = augustGrid()
const DAY_12 = AUGUST.find((d) => d.date === '2026-08-12')!

function renderCalendar(overrides: Partial<Parameters<typeof CalendarViewRoot>[0]> = {}) {
  return render(
    <CalendarViewRoot
      view="month"
      viewYear={2026}
      viewMonth={8}
      days={AUGUST}
      initialDay={DAY_12}
      selectedDate="2026-08-12"
      todayIso="2026-08-15"
      timeZone="America/New_York"
      clients={CLIENTS}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDay.mockImplementation(async (iso: string) => ({
    ok: true,
    data: AUGUST.find((d) => d.date === iso) ?? emptyDay(iso),
  }))
  mockEmail.mockResolvedValue({ ok: true, data: { sent: true, correspondenceId: 5 } })
})

describe('CalendarViewRoot (month view)', () => {
  it('renders the month grid with day counts and the selected day detail', () => {
    renderCalendar()

    expect(screen.getByTestId('calendar-range-label')).toHaveTextContent('Aug 2026')
    const cell = screen.getByTestId('calendar-day-2026-08-12')
    expect(cell).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('day-meeting-count')).toHaveTextContent('1 mtg')
    expect(screen.getByTestId('day-work-count')).toHaveTextContent('1 due')

    // Today is highlighted even though another day is selected.
    expect(screen.getByTestId('calendar-day-2026-08-15')).toHaveAttribute('aria-current', 'date')

    // The detail card lists the day's meeting + work item (stay-on-page drill).
    const detail = screen.getByTestId('calendar-day-detail')
    expect(detail).toHaveTextContent('Wednesday, August 12, 2026')
    expect(screen.getByTestId('detail-meeting')).toHaveTextContent('August close review')
    expect(screen.getByTestId('detail-meeting')).toHaveTextContent('No price set')
    expect(screen.getByTestId('detail-work-item')).toHaveTextContent('Reconcile fixture')
  })

  it('fetches the clicked day through the day action and updates the detail card', async () => {
    renderCalendar()
    await userEvent.click(screen.getByTestId('calendar-day-2026-08-20'))
    await waitFor(() => expect(mockGetDay).toHaveBeenCalledWith('2026-08-20'))
    await waitFor(() =>
      expect(screen.getByTestId('calendar-day-2026-08-20')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByTestId('calendar-day-detail')).toHaveTextContent('No meetings this day.')
  })

  it('emails the client the meeting info from the detail card', async () => {
    renderCalendar()
    await userEvent.click(
      screen.getByRole('button', { name: /email the client the meeting info/i }),
    )
    await waitFor(() => expect(mockEmail).toHaveBeenCalledWith(7))
  })

  it('navigates months and weeks through link hrefs', () => {
    renderCalendar()
    expect(screen.getByLabelText('Previous month')).toHaveAttribute(
      'href',
      '/calendar?view=month&month=2026-07&day=2026-07-01',
    )
    expect(screen.getByLabelText('Next month')).toHaveAttribute(
      'href',
      '/calendar?view=month&month=2026-09&day=2026-09-01',
    )
    expect(screen.getByTestId('calendar-view-week')).toHaveAttribute(
      'href',
      '/calendar?view=week&month=2026-08&day=2026-08-12',
    )
    expect(screen.getByTestId('calendar-today')).toHaveAttribute(
      'href',
      '/calendar?view=month&month=2026-08&day=2026-08-15',
    )
  })

  it('opens the create dialog from the green action', async () => {
    renderCalendar()
    await userEvent.click(screen.getByTestId('new-meeting-button'))
    expect(screen.getByTestId('meeting-dialog')).toBeInTheDocument()
  })

  it('week view renders a 7-day strip', () => {
    const weekDays = AUGUST.filter((d) => d.date >= '2026-08-09' && d.date <= '2026-08-15')
    renderCalendar({ view: 'week', days: weekDays })
    expect(screen.getByTestId('calendar-range-label')).toHaveTextContent('Aug 9 - Aug 15')
    expect(screen.getByTestId('calendar-day-2026-08-09')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-day-2026-08-16')).not.toBeInTheDocument()
  })
})
