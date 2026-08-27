'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { fullDateLabel, moneyLabel } from '@/components/clients/format'
import { formatInstant } from '@/components/portal/format'
import { YearNav } from '@/components/tax/year-nav'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createProformaRequestAction,
  createPropertyAction,
  deletePropertyAction,
  updatePropertyAction,
  upsertProformaAction,
} from '@/server/actions/properties'
import { DEPRECIATION_FIELDS, PROFORMA_FIGURE_FIELDS } from '@/shared/lib/proforma'
import { WorkStatusBadge } from '@/shared/ui/work'

import {
  DEPRECIATION_FIELD_LABELS,
  PROFORMA_CELL_META,
  PROFORMA_FIELD_LABELS,
  PROFORMA_REQUEST_META,
  PROPERTY_STATUS_META,
  depreciationKnownSummary,
  type ProformaCellItem,
  type ProformaRequestItem,
  type PropertyItem,
} from './view-model'

/**
 * Client Properties tab (HANDOFF §20). Property table with sale status,
 * annual financials, mortgage and QBO class, plus the property x year
 * pro-forma grid. Staff can enter figures inline; the "request pro formas"
 * action notifies the client's portal users and the request auto-completes
 * once every non-sold property has a portal-submitted row.
 */

// ── Add / edit property dialog ────────────────────────────────────────────

interface DepreciationDraft {
  value: string
  known: boolean
}

function depreciationDraftOf(property: PropertyItem | null): Record<string, DepreciationDraft> {
  const draft: Record<string, DepreciationDraft> = {}
  for (const key of DEPRECIATION_FIELDS) {
    const entry = property?.depreciation[key]
    draft[key] = {
      value: entry?.value != null ? String(entry.value) : '',
      known: entry?.known === true,
    }
  }
  return draft
}

interface PropertyFormDialogProps {
  clientId: number
  property: PropertyItem | null // null = create
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function PropertyFormDialog({ clientId, property, open, onOpenChange, onSaved }: PropertyFormDialogProps) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(property?.name ?? '')
  const [propertyType, setPropertyType] = useState(property?.propertyType ?? '')
  const [qboClassName, setQboClassName] = useState(property?.qboClassName ?? '')
  const [addressLine1, setAddressLine1] = useState(property?.addressLine1 ?? '')
  const [city, setCity] = useState(property?.city ?? '')
  const [state, setState] = useState(property?.state ?? '')
  const [zip, setZip] = useState(property?.zip ?? '')
  const [isSold, setIsSold] = useState(property?.isSold ?? false)
  const [soldDate, setSoldDate] = useState(property?.soldDate ?? '')
  const [salePrice, setSalePrice] = useState(property?.salePrice ?? '')
  const [purchasePrice, setPurchasePrice] = useState(property?.purchasePrice ?? '')
  const [purchaseDate, setPurchaseDate] = useState(property?.purchaseDate ?? '')
  const [annualRevenue, setAnnualRevenue] = useState(property?.annualRevenue ?? '')
  const [annualExpenses, setAnnualExpenses] = useState(property?.annualExpenses ?? '')
  const [mortgageLender, setMortgageLender] = useState(property?.mortgageLender ?? '')
  const [mortgageBalance, setMortgageBalance] = useState(property?.mortgageBalance ?? '')
  const [monthlyPayment, setMonthlyPayment] = useState(property?.monthlyMortgagePayment ?? '')
  const [depreciation, setDepreciation] = useState<Record<string, DepreciationDraft>>(() =>
    depreciationDraftOf(property),
  )

  async function save() {
    setSaving(true)
    const base = {
      name,
      propertyType: propertyType || null,
      qboClassName: qboClassName || null,
      addressLine1: addressLine1 || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      isSold,
      soldDate: isSold && soldDate ? soldDate : null,
      salePrice: isSold && salePrice ? salePrice : null,
      purchasePrice: purchasePrice || null,
      purchaseDate: purchaseDate || null,
      annualRevenue: annualRevenue || null,
      annualExpenses: annualExpenses || null,
      mortgageLender: mortgageLender || null,
      mortgageBalance: mortgageBalance || null,
      monthlyMortgagePayment: monthlyPayment || null,
      depreciation,
    }
    const res: { ok: boolean; error?: string } = property
      ? await updatePropertyAction(property.id, base)
      : await createPropertyAction({ ...base, clientId })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(property ? `Updated ${name}` : `Added ${name}`)
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{property ? `Edit ${property.name}` : 'Add property'}</DialogTitle>
          <DialogDescription>
            Name, QBO class, sale status, and mortgage details feed billing - changing them resyncs
            the client&apos;s recurring services.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="prop-name">Property name</Label>
            <Input id="prop-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="prop-type">Type</Label>
            <Input
              id="prop-type"
              placeholder="Duplex, fourplex, commercial..."
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prop-qbo-class">QBO class name</Label>
            <Input id="prop-qbo-class" value={qboClassName} onChange={(e) => setQboClassName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="prop-address">Address</Label>
            <Input id="prop-address" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="prop-city">City</Label>
            <Input id="prop-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prop-state">State</Label>
              <Input id="prop-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} />
            </div>
            <div>
              <Label htmlFor="prop-zip">ZIP</Label>
              <Input id="prop-zip" value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
          </div>

          <div className="sm:col-span-2 flex items-center gap-2 pt-1">
            <Checkbox
              id="prop-sold"
              checked={isSold}
              onCheckedChange={(checked) => setIsSold(checked === true)}
            />
            <Label htmlFor="prop-sold" className="font-normal">
              Property has been sold
            </Label>
          </div>
          {isSold && (
            <>
              <div>
                <Label htmlFor="prop-sold-date">Sold date</Label>
                <Input id="prop-sold-date" type="date" value={soldDate} onChange={(e) => setSoldDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="prop-sale-price">Sale price</Label>
                <Input
                  id="prop-sale-price"
                  inputMode="decimal"
                  className="tnum"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="prop-purchase-price">Purchase price</Label>
            <Input
              id="prop-purchase-price"
              inputMode="decimal"
              className="tnum"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prop-purchase-date">Purchase date</Label>
            <Input
              id="prop-purchase-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prop-revenue">Annual revenue</Label>
            <Input
              id="prop-revenue"
              inputMode="decimal"
              className="tnum"
              value={annualRevenue}
              onChange={(e) => setAnnualRevenue(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prop-expenses">Annual expenses</Label>
            <Input
              id="prop-expenses"
              inputMode="decimal"
              className="tnum"
              value={annualExpenses}
              onChange={(e) => setAnnualExpenses(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="prop-lender">Mortgage lender</Label>
            <Input id="prop-lender" value={mortgageLender} onChange={(e) => setMortgageLender(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="prop-balance">Mortgage balance</Label>
            <Input
              id="prop-balance"
              inputMode="decimal"
              className="tnum"
              value={mortgageBalance}
              onChange={(e) => setMortgageBalance(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="prop-payment">Monthly mortgage payment</Label>
            <Input
              id="prop-payment"
              inputMode="decimal"
              className="tnum"
              value={monthlyPayment}
              onChange={(e) => setMonthlyPayment(e.target.value)}
            />
          </div>
        </div>

        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Depreciation breakdown
          </legend>
          <p className="mb-2 text-[13px] text-muted-foreground">
            Enter what you have and tick <span className="font-medium text-foreground">Known</span> for
            each confirmed figure.
          </p>
          <div className="grid gap-2">
            {DEPRECIATION_FIELDS.map((key) => (
              <div key={key} className="grid grid-cols-[1fr_9rem_5.5rem] items-center gap-2">
                <Label htmlFor={`dep-${key}`} className="text-[13px] font-normal">
                  {DEPRECIATION_FIELD_LABELS[key]}
                </Label>
                <Input
                  id={`dep-${key}`}
                  inputMode="decimal"
                  className="tnum h-8"
                  value={depreciation[key]?.value ?? ''}
                  onChange={(e) =>
                    setDepreciation((d) => ({ ...d, [key]: { value: e.target.value, known: d[key]?.known ?? false } }))
                  }
                />
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id={`dep-${key}-known`}
                    checked={depreciation[key]?.known ?? false}
                    onCheckedChange={(checked) =>
                      setDepreciation((d) => ({
                        ...d,
                        [key]: { value: d[key]?.value ?? '', known: checked === true },
                      }))
                    }
                  />
                  <Label htmlFor={`dep-${key}-known`} className="text-xs font-normal text-muted-foreground">
                    Known
                  </Label>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || name.trim() === ''}>
            {saving ? 'Saving...' : property ? 'Save changes' : 'Add property'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Pro-forma entry dialog ────────────────────────────────────────────────

interface ProformaEntryDialogProps {
  cell: ProformaCellItem
  year: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function ProformaEntryDialog({ cell, year, open, onOpenChange, onSaved }: ProformaEntryDialogProps) {
  const [saving, setSaving] = useState(false)
  const [figures, setFigures] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {}
    for (const key of PROFORMA_FIGURE_FIELDS) {
      const v = cell.figures[key]
      draft[key] = typeof v === 'number' ? String(v) : ''
    }
    return draft
  })
  const [notes, setNotes] = useState(typeof cell.figures.notes === 'string' ? cell.figures.notes : '')

  async function save() {
    setSaving(true)
    const res = await upsertProformaAction(cell.propertyId, year, { ...figures, notes })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Saved ${year} pro forma for ${cell.propertyName}`)
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {year} pro forma - {cell.propertyName}
          </DialogTitle>
          <DialogDescription>
            Staff-entered figures do not count toward the portal request - the client&apos;s own
            submission completes it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFORMA_FIGURE_FIELDS.map((key) => (
            <div key={key}>
              <Label htmlFor={`pf-${key}`}>{PROFORMA_FIELD_LABELS[key]}</Label>
              <Input
                id={`pf-${key}`}
                inputMode="decimal"
                className="tnum"
                value={figures[key] ?? ''}
                onChange={(e) => setFigures((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label htmlFor="pf-notes">Notes</Label>
            <Textarea id="pf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save pro forma'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────

interface ClientPropertiesPanelProps {
  clientId: number
  year: number
  properties: PropertyItem[]
  proformaCells: ProformaCellItem[]
  proformaRequest: ProformaRequestItem | null
  requiredCount: number
  submittedCount: number
}

export function ClientPropertiesPanel({
  clientId,
  year,
  properties,
  proformaCells,
  proformaRequest,
  requiredCount,
  submittedCount,
}: ClientPropertiesPanelProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PropertyItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PropertyItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [proformaTarget, setProformaTarget] = useState<ProformaCellItem | null>(null)
  const [sendingRequest, setSendingRequest] = useState(false)

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const res = await deletePropertyAction(deleteTarget.id)
    setDeleting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted ${deleteTarget.name}`)
    setDeleteTarget(null)
    router.refresh()
  }

  async function sendRequest() {
    setSendingRequest(true)
    const res = await createProformaRequestAction(clientId, year)
    setSendingRequest(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      res.data.created
        ? `Pro forma request sent for ${year}`
        : `A pro forma request for ${year} is already pending`,
    )
    router.refresh()
  }

  const requestMeta = proformaRequest ? PROFORMA_REQUEST_META[proformaRequest.status] : null

  return (
    <div className="space-y-6">
      {/* ── Properties ── */}
      <section aria-labelledby="properties-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="properties-heading" className="text-sm font-semibold">
            Properties
            <span className="tnum ml-2 text-xs font-normal text-muted-foreground">{properties.length}</span>
          </h2>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditTarget(null)
              setFormOpen(true)
            }}
          >
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Add property
          </Button>
        </div>

        {properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
              <Building2 className="h-5 w-5 text-accent-foreground" aria-hidden />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-foreground">No properties yet</h3>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              Add each rental or commercial property. Mortgages and QBO classes on a property feed
              the client&apos;s billing.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm" data-testid="properties-table">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Property</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Annual revenue</th>
                  <th className="px-4 py-2.5 text-right">Annual expenses</th>
                  <th className="px-4 py-2.5 text-right">Mortgage balance</th>
                  <th className="px-4 py-2.5">QBO class</th>
                  <th className="px-4 py-2.5">Depreciation</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => {
                  const meta = PROPERTY_STATUS_META[p.isSold ? 'sold' : 'active']
                  const dep = depreciationKnownSummary(p.depreciation)
                  const address = [p.addressLine1, p.city, p.state].filter(Boolean).join(', ')
                  return (
                    <tr
                      key={p.id}
                      data-testid="property-row"
                      data-status={p.isSold ? 'sold' : 'active'}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[p.propertyType, address].filter(Boolean).join(' · ') || 'No address on file'}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <WorkStatusBadge status={meta.status} label={meta.label} />
                        {p.isSold && p.soldDate && (
                          <p className="mt-1 text-[11px] text-muted-foreground">Sold {fullDateLabel(p.soldDate)}</p>
                        )}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-foreground">
                        {p.annualRevenue != null ? moneyLabel(p.annualRevenue) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-foreground">
                        {p.annualExpenses != null ? moneyLabel(p.annualExpenses) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-foreground">
                        {p.mortgageBalance != null ? (
                          <>
                            {moneyLabel(p.mortgageBalance)}
                            {p.mortgageLender && (
                              <p className="text-[11px] font-normal text-muted-foreground">{p.mortgageLender}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-foreground">
                        {p.qboClassName ?? <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {dep.total === 0 ? (
                          'Not started'
                        ) : (
                          <span>
                            <span className="tnum">{dep.known}</span> of <span className="tnum">{dep.total}</span> known
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => {
                              setEditTarget(p)
                              setFormOpen(true)
                            }}
                          >
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${p.name}`}
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Pro formas (property x year) ── */}
      <section aria-labelledby="proforma-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="proforma-heading" className="text-sm font-semibold">
            Pro formas
          </h2>
          <YearNav year={year} />
        </div>

        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
          data-testid="proforma-request-bar"
        >
          {requestMeta && proformaRequest ? (
            <div className="flex items-center gap-2">
              <WorkStatusBadge status={requestMeta.status} label={requestMeta.label} />
              <span className="text-xs text-muted-foreground">
                {proformaRequest.status === 'pending' && (
                  <>
                    Sent {formatInstant(proformaRequest.createdAt)}
                    {proformaRequest.requestedByName ? ` by ${proformaRequest.requestedByName}` : ''}
                    {' · '}
                    <span className="tnum">{submittedCount}</span> of <span className="tnum">{requiredCount}</span>{' '}
                    submitted
                  </>
                )}
                {proformaRequest.status === 'completed' && proformaRequest.completedAt && (
                  <>Auto-completed {formatInstant(proformaRequest.completedAt)}</>
                )}
                {proformaRequest.status === 'cancelled' && 'Cancelled'}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No pro forma request for {year}. Request one and the client fills it in from the portal.
            </p>
          )}
          {(!proformaRequest || proformaRequest.status !== 'pending') && (
            <Button type="button" variant="outline" size="sm" onClick={sendRequest} disabled={sendingRequest}>
              <Send aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              {sendingRequest ? 'Sending...' : `Request ${year} pro formas`}
            </Button>
          )}
        </div>

        {proformaCells.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Add a property to start tracking pro formas.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm" data-testid="proforma-grid">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Property</th>
                  <th className="px-4 py-2.5">{year} status</th>
                  <th className="px-4 py-2.5">Last edited</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proformaCells.map((cell) => {
                  const meta = PROFORMA_CELL_META[cell.status]
                  return (
                    <tr
                      key={cell.propertyId}
                      data-testid="proforma-cell"
                      data-status={cell.status}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{cell.propertyName}</td>
                      <td className="px-4 py-2.5">
                        <WorkStatusBadge status={meta.status} label={meta.label} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {cell.lastEditedAt ? (
                          <>
                            {formatInstant(cell.lastEditedAt)}
                            {cell.lastEditedByName ? ` by ${cell.lastEditedByName}` : ''}
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setProformaTarget(cell)}
                        >
                          {cell.status === 'missing' || cell.status === 'sold_excluded' ? 'Enter figures' : 'Edit figures'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen && (
        <PropertyFormDialog
          key={editTarget?.id ?? 'new'}
          clientId={clientId}
          property={editTarget}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={() => router.refresh()}
        />
      )}

      {proformaTarget && (
        <ProformaEntryDialog
          key={`${proformaTarget.propertyId}-${year}`}
          cell={proformaTarget}
          year={year}
          open={proformaTarget != null}
          onOpenChange={(open) => !open && setProformaTarget(null)}
          onSaved={() => router.refresh()}
        />
      )}

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              Deletes the property and its pro-forma history, and resyncs the client&apos;s billing.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete property'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
