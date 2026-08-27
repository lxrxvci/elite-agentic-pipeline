import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2 } from 'lucide-react'

import { requireCpaRolePage } from '@/components/portal/server'
import { getCpaClients } from '@/server/portal'

export const metadata: Metadata = { title: 'Your clients - FirmOS portal' }

/**
 * CPA client list (HANDOFF §12): every active client whose cpa_contact_id
 * matches the signed-in CPA's contact. Read-only surface - the client id in
 * each link is validated against the linked set again on the detail page.
 */
export default async function CpaClientsPage() {
  const state = await requireCpaRolePage()
  const clients = await getCpaClients(state.user)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Your clients</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Clients your firm has linked to your CPA sign-in.
        </p>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <Building2 aria-hidden className="h-5 w-5 text-accent-foreground" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">No linked clients yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            When the firm links a client to your CPA contact, it shows up here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/portal/cpa/${client.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">{client.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="capitalize">{client.bookkeepingFrequency}</span> books
                  </span>
                </span>
                <span className="text-[13px] font-medium text-primary">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
