'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

import { PROFORMA_CELL_META, PROFORMA_FIELD_LABELS } from '@/components/properties/view-model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitPortalProformaAction } from '@/server/actions/properties'
import { PROFORMA_FIGURE_FIELDS } from '@/shared/lib/proforma'
import type { ProformaStatus } from '@/server/properties'
import { WorkStatusBadge } from '@/shared/ui/work'

import { formatInstant } from './format'

/**
 * Portal properties (HANDOFF §12 "Properties: pro-forma entry per property
 * per year"). Rendered only for real-estate clients - the page 404s
 * otherwise and the nav item never renders. A pending staff request shows as
 * a banner; saving each non-sold property's figures submits through the
 * portal path, and the last submission auto-completes the request.
 */

type ProformaCell = ProformaStatus['cells'][number]

interface PortalPropertiesViewProps {
  clientId: number
  year: number
  status: ProformaStatus
}

function PropertyProformaCard({
  clientId,
  year,
  cell,
  onSaved,
}: {
  clientId: number
  year: number
  cell: ProformaCell
  onSaved: (requestCompleted: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  const [figures, setFigures] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {}
    for (const key of PROFORMA_FIGURE_FIELDS) {
      const v = cell.proforma?.figures[key]
      draft[key] = typeof v === 'number' ? String(v) : ''
    }
    return draft
  })
  const [notes, setNotes] = useState(
    typeof cell.proforma?.figures.notes === 'string' ? cell.proforma.figures.notes : '',
  )

  const meta = PROFORMA_CELL_META[cell.status]

  async function save() {
    setSaving(true)
    const res = await submitPortalProformaAction(clientId, cell.propertyId, year, { ...figures, notes })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Saved ${year} pro forma for ${cell.propertyName}`)
    onSaved(res.data.requestCompleted)
  }

  return (
    <section
      aria-label={`${cell.propertyName} pro forma`}
      data-testid="portal-proforma-card"
      data-status={cell.status}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{cell.propertyName}</h3>
          <WorkStatusBadge status={meta.status} label={meta.label} />
        </div>
        {cell.proforma?.lastEditedAt && (
          <p className="text-xs text-muted-foreground">
            Last saved {formatInstant(cell.proforma.lastEditedAt)}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PROFORMA_FIGURE_FIELDS.map((key) => (
          <div key={key}>
            <Label htmlFor={`pf-${cell.propertyId}-${key}`} className="text-xs">
              {PROFORMA_FIELD_LABELS[key]}
            </Label>
            <Input
              id={`pf-${cell.propertyId}-${key}`}
              inputMode="decimal"
              className="tnum"
              value={figures[key] ?? ''}
              onChange={(e) => setFigures((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2 lg:col-span-4">
          <Label htmlFor={`pf-${cell.propertyId}-notes`} className="text-xs">
            Notes for your bookkeeper
          </Label>
          <Textarea
            id={`pf-${cell.propertyId}-notes`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save pro forma'}
        </Button>
      </div>
    </section>
  )
}

export function PortalPropertiesView({ clientId, year, status }: PortalPropertiesViewProps) {
  const router = useRouter()
  const requestPending = status.request?.status === 'pending'

  function onSaved(requestCompleted: boolean) {
    if (requestCompleted) {
      toast.success(`All ${year} pro formas are in - your firm has been notified`)
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {requestPending && (
        <div
          data-testid="proforma-request-banner"
          className="flex items-start gap-3 rounded-xl border border-border bg-status-waiting-client-bg px-4 py-3"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card">
            <Send aria-hidden className="h-4 w-4 text-status-waiting-client" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              Your firm requested {year} pro formas
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Enter next year&apos;s expected income and expenses for each active property below.
              Sold properties are skipped.{' '}
              <span className="tnum">{status.submittedCount}</span> of{' '}
              <span className="tnum">{status.requiredCount}</span> submitted.
            </p>
          </div>
        </div>
      )}

      {status.cells.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No properties are on file yet - your firm adds them from your client record.
        </p>
      ) : (
        status.cells.map((cell) => (
          <PropertyProformaCard
            key={cell.propertyId}
            clientId={clientId}
            year={year}
            cell={cell}
            onSaved={onSaved}
          />
        ))
      )}
    </div>
  )
}
