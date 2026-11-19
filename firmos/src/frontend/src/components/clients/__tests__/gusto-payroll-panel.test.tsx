import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { GustoPayrollPanel } from '../gusto-payroll-panel'

describe('Gusto payroll handoff', () => {
  it('links to Gusto externally and submits a real CSV route without credential fields', () => {
    const { container } = render(<GustoPayrollPanel clientId={42} provider="Gusto" defaultStart="2026-08-03" defaultEnd="2026-08-09" />)
    const link = screen.getByTestId('gusto-login-link')
    expect(link).toHaveAttribute('href', 'https://app.gusto.com/login')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Download hours CSV' }).closest('form')).toHaveAttribute('action', '/api/clients/42/payroll-hours.csv')
    expect(screen.getByText(/not a guaranteed Gusto import or payroll submission/)).toBeInTheDocument()
  })

  it('uses the firm-wide route and includes general tracked work when selected', () => {
    render(<GustoPayrollPanel scope="firm" provider="Gusto" defaultStart="2026-08-03" defaultEnd="2026-08-09" />)
    expect(screen.getByRole('button', { name: 'Download hours CSV' }).closest('form')).toHaveAttribute('action', '/api/payroll-hours.csv')
    expect(screen.getByText(/including general day-clock time/)).toBeInTheDocument()
  })

  it('blocks a reversed period with a visible explanation', async () => {
    const user = userEvent.setup()
    render(<GustoPayrollPanel clientId={42} provider="Gusto" defaultStart="2026-08-03" defaultEnd="2026-08-09" />)
    await user.clear(screen.getByLabelText('Work period end'))
    await user.type(screen.getByLabelText('Work period end'), '2026-08-01')
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a start date on or before the end date.')
    expect(screen.getByTestId('download-payroll-hours')).toBeDisabled()
  })
})
