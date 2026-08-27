'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestPortalChange, updatePortalProfile } from '@/server/actions/portal'
import type { PortalChangeField } from '@/server/portal'
import { WorkStatusBadge } from '@/shared/ui/work'

import { formatInstant } from './format'
import { CHANGE_FIELD_LABELS, CHANGE_REQUEST_META } from './status'

/**
 * Portal profile (HANDOFF §12): phone/email/address edit directly on the
 * caller's own contact; tax structure and cadence fields move only through
 * approval requests. A pending request is displayed in place of the form
 * for that field (submitting a new one supersedes it server-side).
 */

export interface PendingChange {
  id: number
  fieldName: string
  oldValue: string | null
  newValue: string
  createdAt: Date
}

export interface ContactValues {
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

const CONTACT_FIELDS: { key: keyof ContactValues; label: string; type?: string; autoComplete?: string }[] = [
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'addressLine1', label: 'Address line 1', autoComplete: 'address-line1' },
  { key: 'addressLine2', label: 'Address line 2', autoComplete: 'address-line2' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'state', label: 'State', autoComplete: 'address-level1' },
  { key: 'zip', label: 'ZIP', autoComplete: 'postal-code' },
]

export function PortalContactForm({
  clientId,
  initial,
}: {
  clientId: number
  initial: ContactValues
}) {
  const router = useRouter()
  const [values, setValues] = React.useState<ContactValues>(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await updatePortalProfile(clientId, values)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Contact details saved')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Your contact details</CardTitle>
        <CardDescription>These update right away - no approval needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {CONTACT_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`portal-contact-${field.key}`}>{field.label}</Label>
                <Input
                  id={`portal-contact-${field.key}`}
                  type={field.type ?? 'text'}
                  autoComplete={field.autoComplete}
                  value={values[field.key] ?? ''}
                  disabled={pending}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save contact details
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function PortalChangeFieldCard({
  clientId,
  field,
  currentValue,
  pendingRequest,
}: {
  clientId: number
  field: PortalChangeField
  currentValue: string | null
  pendingRequest: PendingChange | null
}) {
  const router = useRouter()
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const label = CHANGE_FIELD_LABELS[field] ?? field

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (value.trim() === '') {
      setError('New value must not be empty')
      return
    }
    setError(null)
    setPending(true)
    try {
      const result = await requestPortalChange(clientId, field, value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Change requested', {
        description: 'Your firm will review and approve it.',
      })
      setValue('')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[13px] text-muted-foreground">
          Current: <span className="font-medium text-foreground">{currentValue ?? 'Not set'}</span>
        </p>
      </div>

      {pendingRequest ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <WorkStatusBadge
            status={CHANGE_REQUEST_META.pending.status}
            label={CHANGE_REQUEST_META.pending.label}
          />
          <p className="text-[13px] text-muted-foreground">
            {pendingRequest.oldValue ?? 'Not set'} to{' '}
            <span className="font-medium text-foreground">{pendingRequest.newValue}</span>
            {' '}· requested {formatInstant(pendingRequest.createdAt)}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={`New ${label}`}
            placeholder={`New ${label.toLowerCase()}`}
            value={value}
            disabled={pending}
            onChange={(e) => setValue(e.target.value)}
            className="sm:max-w-xs"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending} className="h-9">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Request change
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
