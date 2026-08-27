'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { selectPortalClient } from '@/server/actions/portal'

/**
 * Acting-client selection (HANDOFF §12). A client-role login linked to one
 * or more businesses picks the one this session acts for; the choice is
 * written to the httpOnly portal_client_id cookie by the server action.
 * This is a normal first screen, not an error - and it is also where a
 * stale selection (a link the firm removed) lands to re-select.
 */
export function ChooseBusiness({
  clients,
  stale,
}: {
  clients: { clientId: number; clientName: string; relationship: string }[]
  stale: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function choose(clientId: number) {
    setError(null)
    setPendingId(clientId)
    try {
      const result = await selectPortalClient(clientId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent">
        <Building2 aria-hidden className="h-5 w-5 text-accent-foreground" />
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
        Choose your business
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {stale
          ? 'Your previous selection is no longer available. Pick a business to continue.'
          : 'Your sign-in is linked to more than one business. Pick the one you want to work on.'}
      </p>

      <div className="mt-6 flex w-full flex-col gap-2">
        {clients.map((client) => (
          <Card key={client.clientId} className="text-left">
            <CardContent className="p-0">
              <button
                type="button"
                disabled={pendingId != null}
                onClick={() => void choose(client.clientId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {client.clientName}
                  </span>
                  <span className="block text-xs capitalize text-muted-foreground">
                    {client.relationship.replace(/_/g, ' ')}
                  </span>
                </span>
                <span className="text-[13px] font-medium text-primary">
                  {pendingId === client.clientId ? 'Opening…' : 'Open'}
                </span>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
