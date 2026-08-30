import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PortalReportsCalendar } from '../reports-calendar'
import type { PortalReportCell } from '@/server/portal-progress'

/**
 * Portal reports calendar (Wave 4): twelve month cells in the staff cell
 * language - delivered green with a check, undelivered past-due behind,
 * scheduled muted, nothing-scheduled dashed - with downloads kept through
 * the portal-scoped API route.
 */

const cells: PortalReportCell[] = Array.from({ length: 12 }, (_, i) => ({
  year: 2026,
  month: i + 1,
  state: 'no_work',
  dueDate: null,
  docs: [],
}))

cells[5] = {
  year: 2026,
  month: 6,
  state: 'delivered',
  dueDate: null,
  docs: [{ id: 42, fileName: 'june-financials.pdf' }],
}
cells[6] = { year: 2026, month: 7, state: 'past_due', dueDate: '2026-08-10', docs: [] }
cells[7] = { year: 2026, month: 8, state: 'upcoming', dueDate: '2026-09-10', docs: [] }

function renderCalendar() {
  return render(
    <PortalReportsCalendar
      year={2026}
      cells={cells}
      prevYearHref="/portal/reports?year=2025"
      nextYearHref="/portal/reports?year=2027"
    />,
  )
}

describe('PortalReportsCalendar', () => {
  it('renders all twelve months with state labels (never color alone)', () => {
    renderCalendar()

    const calendar = screen.getByTestId('portal-reports-calendar')
    expect(calendar).toBeInTheDocument()
    expect(screen.getAllByTestId('portal-report-cell')).toHaveLength(12)

    expect(screen.getByLabelText('Jun 2026: Delivered, 1 file. Jump to downloads.')).toHaveAttribute(
      'data-state',
      'delivered',
    )
    expect(screen.getByLabelText(/Jul 2026: Past due/)).toHaveAttribute('data-state', 'past_due')
    expect(screen.getByLabelText(/Aug 2026: Scheduled/)).toHaveAttribute('data-state', 'upcoming')
    expect(screen.getByLabelText('Jan 2026: No report scheduled')).toHaveAttribute(
      'data-state',
      'no_work',
    )
  })

  it('keeps downloads through the scoped API route and anchors delivered cells', () => {
    renderCalendar()

    const cell = screen.getByLabelText('Jun 2026: Delivered, 1 file. Jump to downloads.')
    expect(cell).toHaveAttribute('href', '#portal-reports-2026-6')

    const download = screen.getByRole('link', { name: 'Download june-financials.pdf' })
    expect(download).toHaveAttribute('href', '/api/documents/42')
  })

  it('navigates years', () => {
    renderCalendar()
    expect(screen.getByRole('link', { name: 'Previous year' })).toHaveAttribute(
      'href',
      '/portal/reports?year=2025',
    )
    expect(screen.getByRole('link', { name: 'Next year' })).toHaveAttribute(
      'href',
      '/portal/reports?year=2027',
    )
  })
})
