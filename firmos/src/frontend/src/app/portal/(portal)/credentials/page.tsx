import type { Metadata } from 'next'

import { PortalCredentialsPanel } from '@/components/portal/vault-panel'
import { requireClientRolePage } from '@/components/portal/server'
import { listPortalCredentials } from '@/server/vault'

export const metadata: Metadata = { title: 'Portal logins - FirmOS' }

/**
 * Portal credential vault (Phase 3B): the client enters their own bank /
 * software logins. Kill-switch aware through the (portal) layout and the
 * engine; CPAs 404 here (requireClientRolePage). The page lists expected
 * slots (conversion's "grant us login access" set) and saved entries -
 * secrets never reach this payload.
 */
export default async function PortalCredentialsPage() {
  const { state, access } = await requireClientRolePage()
  if (!access) return null

  const vault = await listPortalCredentials(state.user, access.clientId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Logins</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Securely share bank and software logins for {access.clientName} - no passwords over email.
        </p>
      </div>

      <PortalCredentialsPanel
        clientId={access.clientId}
        currentUserId={state.user.id}
        expected={vault.expected}
        saved={vault.saved}
      />
    </div>
  )
}
