import type { Metadata } from 'next'

import { CommissionTiersEditor } from '@/components/admin/commission-tiers-editor'
import { PricingTable } from '@/components/admin/pricing-table'
import { requireRole } from '@/server/auth/guards'
import { getCommissionFloorRate, getCommissionTiers, getEffectivePricing } from '@/server/pricing-config'

export const metadata: Metadata = { title: 'FirmOS - Admin - Pricing' }

/**
 * /admin/pricing - the admin-editable pricing table and commission tier
 * table (owner call notes). Backed by app_settings via pricing-config; every
 * save is admin/owner-only and audit-logged through the action layer.
 */
export default async function AdminPricingPage() {
  await requireRole('admin', 'owner')
  const [rows, tiers, floorRate] = await Promise.all([getEffectivePricing(), getCommissionTiers(), getCommissionFloorRate()])
  return (
    <div className="space-y-4">
      <PricingTable rows={rows} />
      <CommissionTiersEditor tiers={tiers} floorRate={floorRate} />
    </div>
  )
}
