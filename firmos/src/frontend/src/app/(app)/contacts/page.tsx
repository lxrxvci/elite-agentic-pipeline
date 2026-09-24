import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactRound } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listContacts } from '@/server/clients'

export const metadata: Metadata = { title: 'FirmOS - Contacts' }

// Contacts change as clients do - never statically prerendered.
export const dynamic = 'force-dynamic'

// Same display labels as the client overview's contacts panel.
const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  primary_contact: 'Primary contact',
  cpa: 'CPA',
  related: 'Related',
}

/**
 * Contacts - every person and entity at every client (HANDOFF §7). Read-
 * only directory: data and authorization live in src/server/clients.ts
 * (listContacts), this page owns presentation.
 */
export default async function ContactsPage() {
  const { rows } = await listContacts()

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Contacts
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{rows.length}</span> records · every person at every client, with their relationship.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <ContactRound className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No contacts yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Contacts attach to clients as they’re added - including who gets statements and who
            answers document requests.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
                  Name
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Email
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Phone
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wider">
                  Clients
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="contact-row" className="h-12">
                  <TableCell className="px-4 py-0">
                    <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                    {row.type === 'entity' && (
                      <span className="ml-2 text-xs text-muted-foreground">Entity</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="text-xs text-muted-foreground">{row.email ?? '—'}</span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.phone ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-0">
                    {row.clients.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Not linked</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {row.clients.map((c) => (
                          <span key={c.clientId} className="text-xs">
                            <Link
                              href={`/clients/${c.clientId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {c.clientName}
                            </Link>
                            <span className="text-muted-foreground">
                              {' '}
                              · {RELATIONSHIP_LABELS[c.relationshipType] ?? c.relationshipType}
                            </span>
                            {/* Correspondence hub: straight to the two-way history. */}
                            <Link
                              href={`/clients/${c.clientId}?tab=correspondence`}
                              className="ml-1.5 text-muted-foreground hover:text-primary hover:underline"
                            >
                              correspondence
                            </Link>
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
