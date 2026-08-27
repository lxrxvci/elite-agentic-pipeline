import type { Metadata } from 'next'

import { PortalInvoicesList } from '@/components/portal/invoices-list'
import { requireClientRolePage } from '@/components/portal/server'
import { getPortalInvoices } from '@/server/portal-invoices'

export const metadata: Metadata = { title: 'Portal invoices - FirmOS' }

/**
 * Portal invoices (HANDOFF §12): read-only list of the acting client's
 * non-draft invoices. Membership is validated inside getPortalInvoices on
 * every call; drafts never leave the staff surface.
 */
export default async function PortalInvoicesPage() {
  const { state, access } = await requireClientRolePage()
  if (!access) return null

  const invoices = await getPortalInvoices(state.user, access.clientId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Invoices</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Invoices from your firm for {access.clientName}. Read-only.
        </p>
      </div>

      <PortalInvoicesList invoices={invoices} />
    </div>
  )
}
