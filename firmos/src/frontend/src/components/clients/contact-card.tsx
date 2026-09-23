import { Mail, MapPin, Phone } from 'lucide-react'

import type { ClientContactRow } from '@/server/clients'

/**
 * FreshBooks-style contact card directly under the client name (Jason's
 * "hard to look at" fix): the primary contact in a soft brand-tinted avatar
 * circle, then email / phone / address rows with icons. Read-only; all data
 * already arrives on ClientDetail - no extra queries.
 */

const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  primary_contact: 'Primary contact',
  cpa: 'CPA',
  related: 'Related',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase()
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}

function ContactLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{`${label}: `}</span>
      <span className="truncate text-xs text-foreground">{value}</span>
    </div>
  )
}

export function ClientContactCard({
  contacts,
  address,
}: {
  contacts: ClientContactRow[]
  /** Pre-joined business address lines; null when none is on file. */
  address: string | null
}) {
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null

  if (!primary && !address) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="contact-card-empty">
        No contact details yet - contacts arrive with intake conversion.
      </p>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3"
      data-testid="contact-card"
    >
      {primary && (
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-firm-brand-soft text-sm font-bold text-firm-brand-strong"
          >
            {initialsOf(primary.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {primary.name}
              <span className="sr-only">
                {` (${RELATIONSHIP_LABELS[primary.relationshipType] ?? primary.relationshipType})`}
              </span>
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {RELATIONSHIP_LABELS[primary.relationshipType] ?? primary.relationshipType}
            </p>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5">
        {primary?.email && <ContactLine icon={Mail} label="Email" value={primary.email} />}
        {primary?.phone && <ContactLine icon={Phone} label="Phone" value={primary.phone} />}
        {address && <ContactLine icon={MapPin} label="Address" value={address} />}
      </div>
    </div>
  )
}
