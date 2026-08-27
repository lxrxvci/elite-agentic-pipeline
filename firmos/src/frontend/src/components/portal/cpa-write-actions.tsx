'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createPortalRequest, requestPortalChange } from '@/server/actions/portal'
import type { PortalChangeField, PortalRequestKind } from '@/server/portal'

import { CHANGE_FIELD_LABELS } from './status'

/**
 * CPA write surface (HANDOFF §12): exactly three writes - field change
 * requests (tax_structure, tax_id, accounting_method), tax-document
 * requests, and team requests. The CPA role has no upload or direct-edit
 * affordances anywhere; the engine enforces the same list server-side.
 */

// Mirrors CPA_CHANGEABLE_FIELDS in src/server/portal.ts. Duplicated on
// purpose: this is a client component, and importing the engine's runtime
// const would pull the db layer into the browser bundle.
const CPA_FIELDS = ['tax_structure', 'tax_id', 'accounting_method'] as const satisfies readonly PortalChangeField[]
export function CpaWriteActions({ clientId }: { clientId: number }) {
  const router = useRouter()
  const [field, setField] = React.useState<PortalChangeField>('tax_structure')
  const [fieldValue, setFieldValue] = React.useState('')
  const [taxDetails, setTaxDetails] = React.useState('')
  const [teamDetails, setTeamDetails] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  async function run(key: string, action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, done: () => void) {
    setError(null)
    setPending(key)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      done()
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Request a profile change</CardTitle>
          <CardDescription>Goes to the firm for approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (fieldValue.trim() === '') {
                setError('New value must not be empty')
                return
              }
              void run(
                'change',
                () => requestPortalChange(clientId, field, fieldValue),
                () => {
                  toast.success('Change requested')
                  setFieldValue('')
                },
              )
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cpa-change-field">Field</Label>
              <Select
                value={field}
                onValueChange={(v) => setField(v as PortalChangeField)}
                disabled={pending != null}
              >
                <SelectTrigger id="cpa-change-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CPA_FIELDS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {CHANGE_FIELD_LABELS[f] ?? f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cpa-change-value">New value</Label>
              <Input
                id="cpa-change-value"
                value={fieldValue}
                disabled={pending != null}
                onChange={(e) => setFieldValue(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={pending != null}>
              {pending === 'change' && <Loader2 className="animate-spin" aria-hidden />}
              Request change
            </Button>
          </form>
        </CardContent>
      </Card>

      <CpaRequestCard
        title="Request a tax document"
        description="Mints a task for the client's bookkeeper."
        label="Which document do you need?"
        value={taxDetails}
        onChange={setTaxDetails}
        pending={pending === 'tax'}
        disabled={pending != null}
        onSubmit={() => {
          if (taxDetails.trim() === '') {
            setError('Request details must not be empty')
            return
          }
          void run(
            'tax',
            () => createPortalRequest(clientId, 'tax_document' satisfies PortalRequestKind, taxDetails),
            () => {
              toast.success('Tax document request sent')
              setTaxDetails('')
            },
          )
        }}
      />

      <CpaRequestCard
        title="Request from the team"
        description="A question or task for the bookkeeping team."
        label="Details"
        value={teamDetails}
        onChange={setTeamDetails}
        pending={pending === 'team'}
        disabled={pending != null}
        onSubmit={() => {
          if (teamDetails.trim() === '') {
            setError('Request details must not be empty')
            return
          }
          void run(
            'team',
            () => createPortalRequest(clientId, 'team' satisfies PortalRequestKind, teamDetails),
            () => {
              toast.success('Team request sent')
              setTeamDetails('')
            },
          )
        }}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive lg:col-span-3">
          {error}
        </p>
      )}
    </div>
  )
}

function CpaRequestCard({
  title,
  description,
  label,
  value,
  onChange,
  onSubmit,
  pending,
  disabled,
}: {
  title: string
  description: string
  label: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  pending: boolean
  disabled: boolean
}) {
  const id = React.useId()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Textarea
              id={id}
              rows={3}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={disabled}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Send request
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
