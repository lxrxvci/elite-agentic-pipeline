'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileDown, Mail, Pencil, Plus, Upload, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { moneyLabel } from '@/components/clients/format'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createW9RecipientAction,
  emailW9RequestAction,
  exportOregonCsvAction,
  mark1099SentAction,
  markW9ReceivedAction,
  updateW9RecipientAction,
  uploadW9DocumentAction,
} from '@/server/actions/w9'
import type { W9RecipientInput } from '@/server/w9'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

import { YearNav } from '../tax/year-nav'

/**
 * Client W-9/1099 tab (§18). Status flow pending_w9 -> w9_received ->
 * 1099_sent; action availability is derived from the status and nothing
 * else. The $600 threshold drives the needs-1099 flag unless a manual
 * override is set. The Oregon CSV export is firm-wide for the year (engine
 * contract) and is labelled as such.
 */

export type W9Status = 'pending_w9' | 'w9_received' | '1099_sent'

export const W9_STATUS_META: Record<W9Status, { status: WorkStatus; label: string }> = {
  pending_w9: { status: 'waiting_client', label: 'W-9 pending' },
  w9_received: { status: 'due_soon', label: 'W-9 received' },
  '1099_sent': { status: 'on_track', label: '1099 sent' },
}

/** Which workflow actions a status allows (edit is always available). */
export function w9ActionsFor(status: W9Status): {
  canMarkReceived: boolean
  canMarkSent: boolean
  canUpload: boolean
  canEmailRequest: boolean
} {
  return {
    canMarkReceived: status === 'pending_w9',
    canMarkSent: status === 'w9_received',
    canUpload: status !== '1099_sent',
    canEmailRequest: status === 'pending_w9',
  }
}

export const W9_1099_THRESHOLD_LABEL = 600

export interface W9RecipientItem {
  id: number
  vendorName: string
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  taxId: string | null
  totalPaid: string
  paymentType: string | null
  needs1099ManualOverride: boolean | null
  status: W9Status
  w9RequestedAt: string | null
  w9ReceivedDate: string | null
  form1099SentDate: string | null
  w9DocumentId: number | null
}

export function effectiveNeeds1099(item: Pick<W9RecipientItem, 'totalPaid' | 'needs1099ManualOverride'>): boolean {
  return item.needs1099ManualOverride ?? Number(item.totalPaid) >= W9_1099_THRESHOLD_LABEL
}

export function w9SummaryOf(items: W9RecipientItem[]): {
  total: number
  pendingW9: number
  w9Received: number
  sent1099: number
  needs1099: number
  totalPaidAll: number
} {
  return {
    total: items.length,
    pendingW9: items.filter((i) => i.status === 'pending_w9').length,
    w9Received: items.filter((i) => i.status === 'w9_received').length,
    sent1099: items.filter((i) => i.status === '1099_sent').length,
    needs1099: items.filter((i) => effectiveNeeds1099(i)).length,
    totalPaidAll: items.reduce((sum, i) => sum + Number(i.totalPaid), 0),
  }
}

// ── Add / edit dialog ─────────────────────────────────────────────────────

interface RecipientFormProps {
  clientId: number
  year: number
  recipient: W9RecipientItem | null // null = create
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function RecipientFormDialog({ clientId, year, recipient, open, onOpenChange, onSaved }: RecipientFormProps) {
  const [saving, setSaving] = useState(false)
  const [vendorName, setVendorName] = useState(recipient?.vendorName ?? '')
  const [email, setEmail] = useState(recipient?.email ?? '')
  const [totalPaid, setTotalPaid] = useState(recipient?.totalPaid ?? '0')
  const [paymentType, setPaymentType] = useState(recipient?.paymentType ?? '')
  const [state, setState] = useState(recipient?.state ?? '')
  const [taxId, setTaxId] = useState(recipient?.taxId ?? '')
  const [override, setOverride] = useState(
    recipient?.needs1099ManualOverride == null ? 'auto' : recipient.needs1099ManualOverride ? 'yes' : 'no',
  )

  async function save() {
    setSaving(true)
    const base = {
      vendorName,
      email: email || null,
      totalPaid: totalPaid || '0',
      paymentType: paymentType || null,
      state: state || null,
      taxId: taxId || null,
      needs1099ManualOverride: override === 'auto' ? null : override === 'yes',
    }
    // The actions' success arms widen ok to boolean; type the union locally.
    const res: { ok: boolean; error?: string } = recipient
      ? await updateW9RecipientAction(recipient.id, base)
      : await createW9RecipientAction({ ...base, clientId, year } satisfies W9RecipientInput)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(recipient ? `Updated ${vendorName}` : `Added ${vendorName}`)
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{recipient ? `Edit ${recipient.vendorName}` : 'Add W-9 recipient'}</DialogTitle>
          <DialogDescription>
            Recipient for {year}. Needs-1099 derives from the $600 threshold unless overridden.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="w9-vendor">Vendor name</Label>
            <Input id="w9-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="w9-email">Email</Label>
            <Input id="w9-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="w9-total">Total paid</Label>
            <Input
              id="w9-total"
              inputMode="decimal"
              className="tnum"
              value={totalPaid}
              onChange={(e) => setTotalPaid(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="w9-payment-type">Payment type</Label>
            <Input
              id="w9-payment-type"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="w9-state">State</Label>
            <Input id="w9-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} />
          </div>
          <div>
            <Label htmlFor="w9-tax-id">Tax ID</Label>
            <Input id="w9-tax-id" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <div>
            <Label>Needs 1099</Label>
            <Select value={override} onValueChange={setOverride}>
              <SelectTrigger aria-label="Needs 1099">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto ($600 threshold)</SelectItem>
                <SelectItem value="yes">Yes (override)</SelectItem>
                <SelectItem value="no">No (override)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || vendorName.trim() === ''}>
            {saving ? 'Saving...' : recipient ? 'Save changes' : 'Add recipient'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────

interface ClientW9PanelProps {
  clientId: number
  year: number
  recipients: W9RecipientItem[]
}

export function ClientW9Panel({ clientId, year, recipients }: ClientW9PanelProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<W9RecipientItem | null>(null)
  const [emailTarget, setEmailTarget] = useState<W9RecipientItem | null>(null)
  const [emailAddress, setEmailAddress] = useState('')
  const [uploadTarget, setUploadTarget] = useState<W9RecipientItem | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const summary = w9SummaryOf(recipients)

  async function run(recipientId: number, action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusyId(recipientId)
    const res = await action()
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error ?? 'Something went wrong')
      return false
    }
    toast.success(success)
    router.refresh()
    return true
  }

  async function uploadW9() {
    const file = fileInputRef.current?.files?.[0]
    if (!uploadTarget || !file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ok = await run(
      uploadTarget.id,
      () => uploadW9DocumentAction(uploadTarget.id, { fileName: file.name, bytes, mimeType: file.type || null }),
      `Uploaded W-9 for ${uploadTarget.vendorName}`,
    )
    if (ok) {
      setUploadTarget(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function sendRequest() {
    if (!emailTarget) return
    const ok = await run(
      emailTarget.id,
      () => emailW9RequestAction(emailTarget.id, emailAddress),
      `W-9 request emailed to ${emailAddress}`,
    )
    if (ok) setEmailTarget(null)
  }

  async function exportCsv() {
    setExporting(true)
    const res: { ok: boolean; error?: string; data?: string } = await exportOregonCsvAction(year)
    setExporting(false)
    if (!res.ok || res.data == null) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return
    }
    const blob = new Blob([res.data], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oregon-1099-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported Oregon 1099 CSV for ${year}`)
  }

  return (
    <div className="space-y-3">
      {/* $600 summary card */}
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
        data-testid="w9-summary"
      >
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{summary.needs1099}</span> of{' '}
          <span className="tnum">{summary.total}</span> need a 1099 ({'$'}
          {W9_1099_THRESHOLD_LABEL} threshold)
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{summary.pendingW9}</span> W-9 pending
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{summary.w9Received}</span> received
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{summary.sent1099}</span> sent
        </p>
        <p className="text-xs text-muted-foreground">
          Total paid <span className="tnum font-semibold text-foreground">{moneyLabel(summary.totalPaidAll)}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <YearNav year={year} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            <FileDown aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            {exporting ? 'Exporting...' : 'Oregon CSV (firm-wide)'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditTarget(null)
              setFormOpen(true)
            }}
          >
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Add recipient
          </Button>
        </div>
      </div>

      {recipients.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <UserCheck className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No recipients for {year}</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Add each vendor paid $600 or more so the firm can track W-9s and 1099 delivery.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm" data-testid="w9-table">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Vendor</th>
                <th className="px-4 py-2.5 text-right">Total paid</th>
                <th className="px-4 py-2.5">Needs 1099</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">W-9 document</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => {
                const meta = W9_STATUS_META[r.status]
                const actions = w9ActionsFor(r.status)
                const busy = busyId === r.id
                return (
                  <tr key={r.id} data-testid="w9-row" data-status={r.status} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.vendorName}</p>
                      {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-foreground">{moneyLabel(r.totalPaid)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {effectiveNeeds1099(r) ? (
                        <span className="font-semibold text-foreground">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                      {r.needs1099ManualOverride != null && (
                        <span className="ml-1 text-muted-foreground">(override)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <WorkStatusBadge status={meta.status} label={meta.label} />
                      {r.w9RequestedAt && r.status === 'pending_w9' && (
                        <p className="mt-1 text-[11px] text-muted-foreground">Request emailed</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.w9DocumentId ? (
                        <a
                          href={`/api/documents/${r.w9DocumentId}`}
                          download
                          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          <Download aria-hidden className="h-3 w-3" />
                          W-9
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {actions.canMarkReceived && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(r.id, () => markW9ReceivedAction(r.id), `W-9 received for ${r.vendorName}`)}
                          >
                            Mark W-9 received
                          </Button>
                        )}
                        {actions.canMarkSent && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(r.id, () => mark1099SentAction(r.id), `1099 sent for ${r.vendorName}`)}
                          >
                            Mark 1099 sent
                          </Button>
                        )}
                        {actions.canUpload && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Upload W-9 for ${r.vendorName}`}
                            onClick={() => setUploadTarget(r)}
                          >
                            <Upload aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {actions.canEmailRequest && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Email W-9 request for ${r.vendorName}`}
                            onClick={() => {
                              setEmailAddress(r.email ?? '')
                              setEmailTarget(r)
                            }}
                          >
                            <Mail aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${r.vendorName}`}
                          onClick={() => {
                            setEditTarget(r)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil aria-hidden className="h-3.5 w-3.5" />
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

      {formOpen && (
        <RecipientFormDialog
          key={editTarget?.id ?? 'new'}
          clientId={clientId}
          year={year}
          recipient={editTarget}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={() => router.refresh()}
        />
      )}

      {/* Email W-9 request */}
      <Dialog open={emailTarget != null} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email W-9 request</DialogTitle>
            <DialogDescription>
              Sends the request to the address below and stamps the request date. There is no
              automated reminder - resend from here when needed.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="w9-request-email">Email address</Label>
            <Input
              id="w9-request-email"
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setEmailTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={sendRequest} disabled={!emailAddress.includes('@')}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload W-9 */}
      <Dialog open={uploadTarget != null} onOpenChange={(open) => !open && setUploadTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload W-9{uploadTarget ? ` - ${uploadTarget.vendorName}` : ''}</DialogTitle>
            <DialogDescription>
              Stores the signed form as a document on the client record. Uploading a W-9 for a
              pending recipient marks it received.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="w9-file">Signed W-9 file</Label>
            <Input id="w9-file" type="file" ref={fileInputRef} accept=".pdf,image/*" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setUploadTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={uploadW9} disabled={busyId != null}>
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
