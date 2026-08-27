import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CapacityReport, CapacityStaffRow } from '@/server/capacity'

import { CapacityGrid } from '../capacity-grid'

/**
 * The grid renders the engine's verdicts verbatim: card counts per week,
 * clocked-vs-approved hours on the current week, and the overloaded/heavy
 * state as token + icon + label (never color alone).
 */

const WEEK_STARTS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']

function row(partial: Partial<CapacityStaffRow> & Pick<CapacityStaffRow, 'userId' | 'name'>): CapacityStaffRow {
  const counts = partial.weeks?.map((w) => w.openCount) ?? [3, 2, 2, 1, 0]
  return {
    role: 'bookkeeper',
    clockedMinutesThisWeek: 450,
    approvedMinutesPerWeek: 2400,
    loadThisWeek: 'ok',
    weeks: counts.map((openCount, i) => ({
      weekStartIso: WEEK_STARTS[i],
      openCount,
      load: i === 0 ? (partial.loadThisWeek ?? 'ok') : openCount > 12 ? 'overloaded' : openCount >= 8 ? 'heavy' : 'ok',
    })),
    ...partial,
  }
}

function report(rows: CapacityStaffRow[]): CapacityReport {
  return {
    today: '2026-08-15',
    weekStartIsos: WEEK_STARTS,
    thresholds: { overloadCards: 12, heavyCards: 8, heavyHoursRatio: 0.85 },
    scope: 'all_staff',
    rows,
  }
}

describe('CapacityGrid', () => {
  it('renders one row per staff member and five week columns', () => {
    render(
      <CapacityGrid
        report={report([
          row({ userId: 1, name: 'Jorge Medina' }),
          row({ userId: 2, name: 'Sofia Lindqvist' }),
        ])}
      />,
    )
    expect(screen.getAllByTestId('capacity-row')).toHaveLength(2)
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Week of Sep 7')).toBeInTheDocument()
    expect(screen.getByText('Jorge Medina')).toBeInTheDocument()
  })

  it('shows card counts and clocked vs approved hours on the current week', () => {
    render(
      <CapacityGrid
        report={report([
          row({
            userId: 1,
            name: 'Jorge Medina',
            clockedMinutesThisWeek: 1935,
            approvedMinutesPerWeek: 1800,
            weeks: WEEK_STARTS.map((iso, i) => ({
              weekStartIso: iso,
              openCount: i === 0 ? 14 : 2,
              load: 'ok',
            })),
          }),
        ])}
      />,
    )
    const current = screen.getByTestId('capacity-cell-current')
    expect(current).toHaveTextContent('14 cards')
    expect(current).toHaveTextContent('32.3 / 30.0 h clocked')
  })

  it('marks overloaded cells with an icon and a text label, not color alone', () => {
    render(
      <CapacityGrid
        report={report([
          row({
            userId: 1,
            name: 'Jorge Medina',
            loadThisWeek: 'overloaded',
            weeks: WEEK_STARTS.map((iso, i) => ({
              weekStartIso: iso,
              openCount: i === 0 ? 14 : 2,
              load: i === 0 ? 'overloaded' : 'ok',
            })),
          }),
        ])}
      />,
    )
    const current = screen.getByTestId('capacity-cell-current')
    expect(current).toHaveAttribute('data-load', 'overloaded')
    expect(within(current).getByText('Overloaded')).toBeInTheDocument()
  })

  it('marks heavy weeks with the due-soon label', () => {
    render(
      <CapacityGrid
        report={report([
          row({
            userId: 1,
            name: 'Jorge Medina',
            weeks: WEEK_STARTS.map((iso, i) => ({
              weekStartIso: iso,
              openCount: i === 2 ? 9 : 1,
              load: i === 2 ? 'heavy' : 'ok',
            })),
          }),
        ])}
      />,
    )
    const heavy = document.querySelector('[data-load="heavy"]')
    expect(heavy).not.toBeNull()
    expect(heavy).toHaveTextContent('Heavy')
  })

  it('omits the approved-hours denominator when no schedule is approved', () => {
    render(
      <CapacityGrid
        report={report([
          row({ userId: 1, name: 'Jorge Medina', approvedMinutesPerWeek: null }),
        ])}
      />,
    )
    const current = screen.getByTestId('capacity-cell-current')
    expect(current).toHaveTextContent('7.5 h clocked')
    expect(current).not.toHaveTextContent('/')
  })

  it('links each staff member to the hours report', () => {
    render(<CapacityGrid report={report([row({ userId: 1, name: 'Jorge Medina' })])} />)
    expect(screen.getByRole('link', { name: /Jorge Medina/i })).toHaveAttribute(
      'href',
      '/reports/hours',
    )
  })

  it('documents the overload rule in the legend', () => {
    render(<CapacityGrid report={report([row({ userId: 1, name: 'Jorge Medina' })])} />)
    expect(screen.getByText(/overload rule/i)).toHaveTextContent('12')
  })
})
