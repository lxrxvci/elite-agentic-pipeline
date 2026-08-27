import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ClientPropertiesPanel } from '../client-properties-panel'
import type { ProformaCellItem, ProformaRequestItem, PropertyItem } from '../view-model'

/**
 * Client Properties tab (HANDOFF §20): property table with status chips and
 * tnum money, the depreciation known-flag checkboxes, the property x year
 * pro-forma grid states, and the request bar.
 */

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/clients/7',
  useSearchParams: () => new URLSearchParams('tab=properties&year=2027'),
}))

vi.mock('@/server/actions/properties', () => ({
  createPropertyAction: vi.fn(async () => ({ ok: true, data: { id: 99 } })),
  updatePropertyAction: vi.fn(async () => ({ ok: true, data: null })),
  deletePropertyAction: vi.fn(async () => ({ ok: true, data: null })),
  upsertProformaAction: vi.fn(async () => ({ ok: true, data: null })),
  createProformaRequestAction: vi.fn(async () => ({ ok: true, data: { requestId: 5, created: true } })),
}))

import { createProformaRequestAction, upsertProformaAction } from '@/server/actions/properties'

function makeProperty(partial: Partial<PropertyItem> & Pick<PropertyItem, 'id' | 'name'>): PropertyItem {
  return {
    propertyType: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    isSold: false,
    soldDate: null,
    salePrice: null,
    purchasePrice: null,
    purchaseDate: null,
    annualRevenue: null,
    annualExpenses: null,
    mortgageLender: null,
    mortgageBalance: null,
    monthlyMortgagePayment: null,
    depreciation: {},
    qboClassName: null,
    merchantProcessor: null,
    ...partial,
  }
}

const MAPLE = makeProperty({
  id: 11,
  name: 'Maple Court Duplex',
  propertyType: 'Duplex',
  addressLine1: '412 Maple Ct',
  city: 'Portland',
  state: 'OR',
  annualRevenue: '39600.00',
  annualExpenses: '14200.00',
  mortgageLender: 'Columbia Bank',
  mortgageBalance: '312450.00',
  monthlyMortgagePayment: '2180.00',
  qboClassName: 'Maple Court',
  depreciation: {
    land_value: { value: 120000, known: true },
    building_value: { value: 365000, known: true },
    improvements: { value: 8500, known: false },
  },
})

const ALDER = makeProperty({ id: 12, name: 'Alder Street Condo', propertyType: 'Condo' })

const CEDAR = makeProperty({
  id: 13,
  name: 'Cedar Street Fourplex',
  isSold: true,
  soldDate: '2026-06-16',
  salePrice: '710000.00',
  qboClassName: 'Cedar Street',
})

const PROPERTIES = [MAPLE, ALDER, CEDAR]

const CELLS: ProformaCellItem[] = [
  {
    propertyId: 11,
    propertyName: 'Maple Court Duplex',
    isSold: false,
    status: 'portal_submitted',
    figures: { rental_income: 40800 },
    fromPortal: true,
    lastEditedAt: '2026-08-10T14:00:00.000Z',
    lastEditedByName: 'Alison Brewer',
  },
  {
    propertyId: 12,
    propertyName: 'Alder Street Condo',
    isSold: false,
    status: 'missing',
    figures: {},
    fromPortal: false,
    lastEditedAt: null,
    lastEditedByName: null,
  },
  {
    propertyId: 13,
    propertyName: 'Cedar Street Fourplex',
    isSold: true,
    status: 'sold_excluded',
    figures: {},
    fromPortal: false,
    lastEditedAt: null,
    lastEditedByName: null,
  },
]

const PENDING_REQUEST: ProformaRequestItem = {
  id: 5,
  status: 'pending',
  createdAt: '2026-08-01T09:00:00.000Z',
  completedAt: null,
  requestedByName: 'Mara Ellison',
}

function renderPanel(overrides: Partial<Parameters<typeof ClientPropertiesPanel>[0]> = {}) {
  return render(
    <ClientPropertiesPanel
      clientId={7}
      year={2027}
      properties={PROPERTIES}
      proformaCells={CELLS}
      proformaRequest={PENDING_REQUEST}
      requiredCount={2}
      submittedCount={1}
      {...overrides}
    />,
  )
}

describe('ClientPropertiesPanel - property table', () => {
  it('renders each property with status chip, tnum money, QBO class, and depreciation coverage', () => {
    renderPanel()

    const rows = screen.getAllByTestId('property-row')
    expect(rows).toHaveLength(3)

    const maple = rows[0]
    expect(maple).toHaveAttribute('data-status', 'active')
    expect(within(maple).getByText('Active')).toBeInTheDocument()
    expect(within(maple).getByText('$39,600.00')).toBeInTheDocument()
    expect(within(maple).getByText('$312,450.00')).toBeInTheDocument()
    expect(within(maple).getByText('Columbia Bank')).toBeInTheDocument()
    expect(within(maple).getByText('Maple Court')).toBeInTheDocument()
    // Depreciation known flags: 2 of 3 entered fields are confirmed known.
    expect(within(maple).getByText(/of/)).toHaveTextContent('2 of 3 known')

    const cedar = rows[2]
    expect(cedar).toHaveAttribute('data-status', 'sold')
    expect(within(cedar).getByText('Sold')).toBeInTheDocument()
    expect(within(cedar).getByText('Sold Jun 16, 2026')).toBeInTheDocument()
    expect(within(cedar).getByText('Not started')).toBeInTheDocument()
  })

  it('edit dialog carries the depreciation fields with per-field Known checkboxes', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Maple Court Duplex' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Depreciation breakdown')).toBeInTheDocument()

    for (const key of ['land_value', 'building_value', 'improvements', 'furniture_fixtures', 'other']) {
      const box = document.getElementById(`dep-${key}-known`)
      expect(box, `known checkbox for ${key}`).not.toBeNull()
    }
    expect(document.getElementById('dep-land_value-known')).toHaveAttribute('data-state', 'checked')
    expect(document.getElementById('dep-building_value-known')).toHaveAttribute('data-state', 'checked')
    expect(document.getElementById('dep-improvements-known')).toHaveAttribute('data-state', 'unchecked')
    // Existing values prefill their inputs.
    expect(screen.getByLabelText('Land value')).toHaveValue('120000')
  })
})

describe('ClientPropertiesPanel - pro forma grid', () => {
  it('renders cell states: portal submitted, missing, sold excluded', () => {
    renderPanel()

    const cells = screen.getAllByTestId('proforma-cell')
    expect(cells).toHaveLength(3)
    expect(cells[0]).toHaveAttribute('data-status', 'portal_submitted')
    expect(within(cells[0]).getByText('Portal submitted')).toBeInTheDocument()
    expect(within(cells[0]).getByText(/by Alison Brewer/)).toBeInTheDocument()
    expect(cells[1]).toHaveAttribute('data-status', 'missing')
    expect(within(cells[1]).getByText('Missing')).toBeInTheDocument()
    expect(cells[2]).toHaveAttribute('data-status', 'sold_excluded')
    expect(within(cells[2]).getByText('Sold - not required')).toBeInTheDocument()
  })

  it('request bar shows pending status with progress; send button hidden while pending', () => {
    renderPanel()
    const bar = screen.getByTestId('proforma-request-bar')
    expect(within(bar).getByText('Request pending')).toBeInTheDocument()
    expect(bar).toHaveTextContent('1 of 2 submitted')
    expect(bar).toHaveTextContent('by Mara Ellison')
    expect(screen.queryByRole('button', { name: /Request 2027 pro formas/ })).not.toBeInTheDocument()
  })

  it('without a request the send button mints one', async () => {
    const user = userEvent.setup()
    renderPanel({ proformaRequest: null })

    await user.click(screen.getByRole('button', { name: 'Request 2027 pro formas' }))
    expect(vi.mocked(createProformaRequestAction)).toHaveBeenCalledWith(7, 2027)
  })

  it('staff entry dialog saves figures for the property and year', async () => {
    const user = userEvent.setup()
    renderPanel()

    const missingCell = screen.getAllByTestId('proforma-cell')[1]
    await user.click(within(missingCell).getByRole('button', { name: 'Enter figures' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('2027 pro forma - Alder Street Condo')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Rental income'), '18600')
    await user.click(within(dialog).getByRole('button', { name: 'Save pro forma' }))

    expect(vi.mocked(upsertProformaAction)).toHaveBeenCalledWith(
      12,
      2027,
      expect.objectContaining({ rental_income: '18600' }),
    )
  })
})
