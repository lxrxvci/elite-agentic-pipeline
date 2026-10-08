import type { Metadata } from 'next'

import { CommissionTiersEditor } from '@/components/admin/commission-tiers-editor'
import { PricingTable } from '@/components/admin/pricing-table'
import { RateTiersEditor } from '@/components/admin/rate-tiers-editor'
import { ServicesCatalogAdmin } from '@/components/admin/services-catalog-admin'
import { requireRole } from '@/server/auth/guards'
import { getCommissionFloorRate, getCommissionTiers, getEffectivePricing, getRateTiers } from '@/server/pricing-config'
import { listServicesCatalog } from '@/server/services-catalog'

export const metadata: Metadata = { title: 'FirmOS - Admin - Pricing' }

/**
 * /admin/pricing - the admin-editable pricing table and commission tier
 * table (owner call notes). Backed by app_settings via pricing-config; every
 * save is admin/owner-only and audit-logged through the action layer.
 */
export default async function AdminPricingPage() {
  await requireRole('admin', 'owner')
  const [rows, tiers, floorRate, catalog, rateTiers] = await Promise.all([getEffectivePricing(), getCommissionTiers(), getCommissionFloorRate(), listServicesCatalog(), getRateTiers()])
  return (
    <div className="space-y-4">
      <PricingTable rows={rows} />
      <ServicesCatalogAdmin rows={catalog} />
      <RateTiersEditor tiers={rateTiers} />
      <CommissionTiersEditor tiers={tiers} floorRate={floorRate} />
    </div>
  )
}
