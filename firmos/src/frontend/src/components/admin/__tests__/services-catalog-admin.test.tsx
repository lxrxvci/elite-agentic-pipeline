import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServicesCatalogAdmin } from '../services-catalog-admin'
import type { ServiceCatalogRow } from '@/server/services-catalog'

/**
 * K3 (J16): the services catalog manager - custom services are created and
 * priced without a deploy; canonical rows rename/hide/toggle add-on.
 */

const addCustomServiceAction = vi.fn()
const renameServiceAction = vi.fn()
const setServiceActiveAction = vi.fn()
const setCustomServicePriceAction = vi.fn()
const setServiceAddonAction = vi.fn()

vi.mock('@/server/actions/services-catalog', () => ({
  addCustomServiceAction: (...args: unknown[]) => addCustomServiceAction(...args),
  renameServiceAction: (...args: unknown[]) => renameServiceAction(...args),
  setServiceActiveAction: (...args: unknown[]) => setServiceActiveAction(...args),
  setCustomServicePriceAction: (...args: unknown[]) => setCustomServicePriceAction(...args),
  setServiceAddonAction: (...args: unknown[]) => setServiceAddonAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ROWS: ServiceCatalogRow[] = [
  {
    id: 1, serviceKey: 'bank_feed_management', productName: 'Bank Feed Management', group: 'core_monthly',
    unit: 'month', unitPrice: null, scaling: 'flat_monthly', bucket: 'monthly',
    isStandard: true, isAddon: false, isActive: true, position: 0, isCustom: false,
  },
  {
    id: 2, serviceKey: 'hoa_dues_entry', productName: 'HOA dues entry', group: 'other',
    unit: 'month', unitPrice: 40, scaling: 'flat_monthly', bucket: 'monthly',
    isStandard: false, isAddon: true, isActive: true, position: 0, isCustom: true,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  addCustomServiceAction.mockResolvedValue({ ok: true, data: ROWS[1] })
  renameServiceAction.mockResolvedValue({ ok: true, data: { done: true } })
  setServiceActiveAction.mockResolvedValue({ ok: true, data: { done: true } })
  setCustomServicePriceAction.mockResolvedValue({ ok: true, data: { done: true } })
  setServiceAddonAction.mockResolvedValue({ ok: true, data: { done: true } })
})

describe('ServicesCatalogAdmin', () => {
  it('adds a custom service with its price and rules', async () => {
    render(<ServicesCatalogAdmin rows={ROWS} />)
    fireEvent.change(screen.getByTestId('service-add-name'), { target: { value: 'Weekend emergency catch-up' } })
    fireEvent.change(screen.getByTestId('service-add-price'), { target: { value: '175' } })
    fireEvent.click(screen.getByTestId('service-add-submit'))
    await waitFor(() =>
      expect(addCustomServiceAction).toHaveBeenCalledWith(
        expect.objectContaining({
          productName: 'Weekend emergency catch-up',
          unitPrice: 175,
          bucket: 'monthly',
          isAddon: true,
        }),
      ),
    )
  })

  it('canonical rows show pricing-table pricing; customs edit their price inline', async () => {
    render(<ServicesCatalogAdmin rows={ROWS} />)
    const canonical = screen.getByTestId('service-row-bank_feed_management')
    expect(canonical).toHaveTextContent('pricing table')

    fireEvent.click(screen.getByTestId('service-price-hoa_dues_entry'))
    fireEvent.change(screen.getByLabelText('Price for HOA dues entry'), { target: { value: '55' } })
    fireEvent.keyDown(screen.getByLabelText('Price for HOA dues entry'), { key: 'Enter' })
    await waitFor(() => expect(setCustomServicePriceAction).toHaveBeenCalledWith('hoa_dues_entry', 55))
  })

  it('rename, hide/show, and add-on membership write through the actions', async () => {
    render(<ServicesCatalogAdmin rows={ROWS} />)

    fireEvent.click(screen.getByTestId('service-rename-bank_feed_management'))
    fireEvent.change(screen.getByLabelText('Rename Bank Feed Management'), { target: { value: 'Bank feed mgmt' } })
    fireEvent.keyDown(screen.getByLabelText('Rename Bank Feed Management'), { key: 'Enter' })
    await waitFor(() => expect(renameServiceAction).toHaveBeenCalledWith('bank_feed_management', 'Bank feed mgmt'))

    fireEvent.click(screen.getByTestId('service-toggle-bank_feed_management'))
    await waitFor(() => expect(setServiceActiveAction).toHaveBeenCalledWith('bank_feed_management', false))

    fireEvent.click(screen.getByTestId('service-addon-hoa_dues_entry'))
    await waitFor(() => expect(setServiceAddonAction).toHaveBeenCalledWith('hoa_dues_entry', false))
  })
})
