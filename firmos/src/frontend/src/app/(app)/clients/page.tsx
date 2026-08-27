import type { Metadata } from 'next'

import { ClientsTable } from '@/components/clients/clients-table'
import { requireStaff } from '@/server/auth/guards'
import { listClients } from '@/server/clients'

export const metadata: Metadata = { title: 'FirmOS - Clients' }

// Per-user, per-day data (health and open work move daily) - never static.
export const dynamic = 'force-dynamic'

/**
 * Clients - every client record in one dense, scannable table. Data and
 * authorization live in src/server/clients.ts; this page owns presentation.
 */
export default async function ClientsPage() {
  const [user, list] = await Promise.all([requireStaff(), listClients()])
  // The Eff. $/hr column is billing content - admin/owner only (§10), and
  // listClients only populates the field for those roles.
  const canSeeRates = user.normalizedRole === 'admin' || user.normalizedRole === 'owner'

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Clients
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{list.rows.length}</span> records · lifecycle state, cadence, team, and health at a glance.
          </p>
        </div>
      </div>
      <ClientsTable rows={list.rows} canSeeRates={canSeeRates} />
    </div>
  )
}
