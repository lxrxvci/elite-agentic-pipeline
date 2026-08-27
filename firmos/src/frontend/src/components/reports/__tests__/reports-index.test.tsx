import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportsIndex, visibleReportLinks } from '../reports-index'

/**
 * Hub visibility mirrors the server page guards: bookkeepers get the
 * personal surfaces only, managers add team views, admin/owner add payroll
 * and time-edit review.
 */
describe('visibleReportLinks', () => {
  it('bookkeepers see My Hours and My Commission only', () => {
    const hrefs = visibleReportLinks('bookkeeper').map((l) => l.href)
    expect(hrefs).toEqual(['/reports/my-hours', '/reports/my-commission', '/reports/tax'])
  })

  it('managers add Team Hours, Capacity, Commission, and Profitability but not Payroll or Time edits', () => {
    const hrefs = visibleReportLinks('manager').map((l) => l.href)
    expect(hrefs).toContain('/reports/hours')
    expect(hrefs).toContain('/reports/capacity')
    expect(hrefs).toContain('/reports/commission')
    expect(hrefs).toContain('/reports/profitability')
    expect(hrefs).toContain('/reports/tax')
    expect(hrefs).not.toContain('/reports/payroll')
    expect(hrefs).not.toContain('/reports/time-edits')
  })

  it('admin sees every section', () => {
    const hrefs = visibleReportLinks('admin').map((l) => l.href)
    expect(hrefs).toEqual([
      '/reports/my-hours',
      '/reports/hours',
      '/reports/capacity',
      '/reports/commission',
      '/reports/profitability',
      '/reports/tax',
      '/reports/payroll',
      '/reports/time-edits',
    ])
  })
})

describe('ReportsIndex', () => {
  it('renders one link card per visible section with a description', () => {
    render(<ReportsIndex role="bookkeeper" />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(screen.getByText('My hours')).toBeInTheDocument()
    expect(screen.getByText('My commission')).toBeInTheDocument()
    expect(screen.getByText('Year-end tax')).toBeInTheDocument()
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument()
  })

  it('renders the admin set', () => {
    render(<ReportsIndex role="owner" />)
    expect(screen.getAllByRole('link')).toHaveLength(8)
    expect(screen.getByText('Staff capacity')).toBeInTheDocument()
    expect(screen.getByText('Payroll')).toBeInTheDocument()
    expect(screen.getByText('Profitability')).toBeInTheDocument()
    expect(screen.getByText('Time edit requests')).toBeInTheDocument()
  })
})
