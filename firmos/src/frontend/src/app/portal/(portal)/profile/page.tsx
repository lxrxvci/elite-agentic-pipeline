import type { Metadata } from 'next'

import {
  PortalChangeFieldCard,
  PortalContactForm,
  type PendingChange,
} from '@/components/portal/profile-forms'
import { requireClientRolePage } from '@/components/portal/server'
import { CHANGE_FIELD_LABELS } from '@/components/portal/status'
import { CLIENT_CHANGEABLE_FIELDS, getPortalProfile } from '@/server/portal'

export const metadata: Metadata = { title: 'Portal profile - FirmOS' }

/**
 * Portal profile (HANDOFF §12): direct-edit contact fields plus
 * approval-request business fields. Read-only firm facts (legal name,
 * business address, accounting method) render as muted metadata - they
 * change through the firm, not the portal.
 */
export default async function PortalProfilePage() {
  const { state, access } = await requireClientRolePage()
  if (!access) return null

  const profile = await getPortalProfile(state.user, access.clientId)
  const pendingByField = new Map<string, PendingChange>(
    profile.pendingChangeRequests.map((r) => [r.fieldName, r]),
  )

  const currentValueOf = (field: (typeof CLIENT_CHANGEABLE_FIELDS)[number]): string | null => {
    switch (field) {
      case 'tax_structure':
        return profile.client.taxStructure
      case 'bookkeeping_frequency':
        return profile.client.bookkeepingFrequency
      case 'billing_frequency':
        return profile.client.billingFrequency
    }
  }

  const businessAddress = [
    profile.client.businessAddress,
    [profile.client.businessCity, profile.client.businessState].filter(Boolean).join(', '),
    profile.client.businessZip,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Contact details and business settings for {access.clientName}.
        </p>
      </div>

      <section aria-label="Business facts" className="rounded-lg border border-border bg-card px-4 py-3">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:justify-start">
            <dt className="text-muted-foreground">Legal name</dt>
            <dd className="font-medium text-foreground">{profile.client.legalName}</dd>
          </div>
          {profile.client.dbaName && (
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">DBA</dt>
              <dd className="font-medium text-foreground">{profile.client.dbaName}</dd>
            </div>
          )}
          {businessAddress && (
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">Business address</dt>
              <dd className="font-medium text-foreground">{businessAddress}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 sm:justify-start">
            <dt className="text-muted-foreground">Accounting method</dt>
            <dd className="font-medium capitalize text-foreground">
              {profile.client.accountingMethod ?? 'Not set'}
            </dd>
          </div>
        </dl>
      </section>

      {profile.contact && profile.canEditContact ? (
        <PortalContactForm clientId={access.clientId} initial={profile.contact} />
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          Contact editing is not available for this sign-in. Ask your firm to update your contact
          details.
        </p>
      )}

      <section aria-labelledby="portal-change-requests">
        <h2 id="portal-change-requests" className="mb-1 text-sm font-semibold">
          Business settings
        </h2>
        <p className="mb-3 text-[13px] text-muted-foreground">
          These fields change by approval - send a request and your firm reviews it.
        </p>
        <div className="flex flex-col gap-3">
          {CLIENT_CHANGEABLE_FIELDS.map((field) => (
            <PortalChangeFieldCard
              key={field}
              clientId={access.clientId}
              field={field}
              currentValue={currentValueOf(field)}
              pendingRequest={pendingByField.get(field) ?? null}
            />
          ))}
        </div>
        {profile.pendingChangeRequests.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Pending requests are reviewed by your firm; sending a new request for the same field
            replaces the old one.
            {' '}
            {profile.pendingChangeRequests
              .map((r) => CHANGE_FIELD_LABELS[r.fieldName] ?? r.fieldName)
              .join(', ')}{' '}
            awaiting review.
          </p>
        )}
      </section>
    </div>
  )
}
