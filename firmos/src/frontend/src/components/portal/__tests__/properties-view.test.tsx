import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ProformaStatus } from '@/server/properties'

import { PortalPropertiesView } from '../properties-view'

/**
 * Portal properties (HANDOFF §12/§20): the pending-request banner, the
 * per-property pro-forma form, and the save path that reports auto-complete.
 */

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/server/actions/properties', () => ({
  submitPortalProformaAction: vi.fn(async () => ({ ok: true, data: { requestCompleted: false } })),
}))

import { submitPortalProformaAction } from '@/server/actions/properties'

function makeStatus(overrides: Partial<ProformaStatus> = {}): ProformaStatus {
  return {
    year: 2027,
    request: {
      id: 5,
      year: 2027,
      status: 'pending',
      requestedById: 1,
      createdAt: '2026-08-01T09:00:00.000Z',
      completedAt: null,
    },
    cells: [
      {
        propertyId: 11,
        propertyName: 'Maple Court Duplex',
        isSold: false,
        status: 'missing',
        proforma: null,
      },
      {
        propertyId: 13,
        propertyName: 'Cedar Street Fourplex',
        isSold: true,
        status: 'sold_excluded',
        proforma: null,
      },
    ],
    requiredCount: 1,
    submittedCount: 0,
    ...overrides,
  }
}

describe('PortalPropertiesView', () => {
  it('shows the pending request banner with progress', () => {
    render(<PortalPropertiesView clientId={7} year={2027} status={makeStatus()} />)

    const banner = screen.getByTestId('proforma-request-banner')
    expect(banner).toHaveTextContent('Your firm requested 2027 pro formas')
    expect(banner).toHaveTextContent('0 of 1 submitted')
  })

  it('hides the banner when there is no pending request', () => {
    render(
      <PortalPropertiesView clientId={7} year={2027} status={makeStatus({ request: null })} />,
    )
    expect(screen.queryByTestId('proforma-request-banner')).not.toBeInTheDocument()
  })

  it('saves a property pro forma through the portal action and refreshes', async () => {
    const user = userEvent.setup()
    render(<PortalPropertiesView clientId={7} year={2027} status={makeStatus()} />)

    const card = screen.getAllByTestId('portal-proforma-card')[0]
    expect(card).toHaveAttribute('data-status', 'missing')
    await user.type(within(card).getByLabelText('Rental income'), '40800')
    await user.click(within(card).getByRole('button', { name: 'Save pro forma' }))

    expect(vi.mocked(submitPortalProformaAction)).toHaveBeenCalledWith(
      7,
      11,
      2027,
      expect.objectContaining({ rental_income: '40800' }),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('prefills previously submitted figures', () => {
    render(
      <PortalPropertiesView
        clientId={7}
        year={2027}
        status={makeStatus({
          cells: [
            {
              propertyId: 11,
              propertyName: 'Maple Court Duplex',
              isSold: false,
              status: 'portal_submitted',
              proforma: {
                id: 31,
                figures: { rental_income: 40800, notes: 'Same rent roll' },
                fromPortal: true,
                lastEditedById: 9,
                lastEditedAt: '2026-08-10T14:00:00.000Z',
              },
            },
          ],
        })}
      />,
    )
    expect(screen.getByLabelText('Rental income')).toHaveValue('40800')
    expect(screen.getByText('Portal submitted')).toBeInTheDocument()
  })
})
