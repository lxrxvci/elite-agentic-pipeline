'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Check, Download, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  markInvoicePaidAction,
  quickbooksCsvAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from '@/server/actions/invoices'

import { downloadCsv } from './csv'
import { invoiceCsvFilename, type InvoiceStatus } from './format'

/**
 * The status action matrix (HANDOFF §7):
 *   draft   -> Send + Void
 *   sent    -> Mark paid + Void + QBO CSV
 *   overdue -> Mark paid + QBO CSV
 *   paid    -> QBO CSV only
 *   void    -> nothing (terminal)
 * Send, mark-paid, and void are confirm dialogs; the CSV is a direct
 * client-side download of the server-built export.
 */

type ConfirmKind = 'send' | 'paid' | 'void'

const CONFIRM_COPY: Record<ConfirmKind, { title: string; body: string; cta: string }> = {
  send: {
    title: 'Send this invoice?',
    body: 'The invoice moves from draft to sent and the sent timestamp is recorded.',
    cta: 'Send invoice',
  },
  paid: {
    title: 'Mark this invoice paid?',
    body: 'The paid timestamp is recorded. A paid invoice is terminal - it can no longer be voided.',
    cta: 'Mark paid',
  },
  void: {
    title: 'Void this invoice?',
    body: 'The invoice is cancelled and excluded from totals and exports. This cannot be undone.',
    cta: 'Void invoice',
  },
}

export function InvoiceDetailActions({
  invoiceId,
  invoiceNumber,
  status,
}: {
  invoiceId: number
  invoiceNumber: string
  status: InvoiceStatus
}) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const [pending, setPending] = useState(false)
  const [exporting, setExporting] = useState(false)

  const canSend = status === 'draft'
  const canMarkPaid = status === 'sent' || status === 'overdue'
  const canVoid = status === 'draft' || status === 'sent'
  const canCsv = status === 'sent' || status === 'overdue' || status === 'paid'

  async function runConfirmed() {
    if (!confirm) return
    setPending(true)
    const res =
      confirm === 'send'
        ? await sendInvoiceAction(invoiceId)
        : confirm === 'paid'
          ? await markInvoicePaidAction(invoiceId)
          : await voidInvoiceAction(invoiceId)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const done =
      confirm === 'send' ? 'Invoice sent' : confirm === 'paid' ? 'Invoice marked paid' : 'Invoice voided'
    toast.success(done)
    setConfirm(null)
    router.refresh()
  }

  async function exportCsv() {
    setExporting(true)
    const res = await quickbooksCsvAction([invoiceId])
    setExporting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    downloadCsv(invoiceCsvFilename(invoiceNumber, invoiceId), res.data)
    toast.success('QuickBooks CSV downloaded')
  }

  if (!canSend && !canMarkPaid && !canVoid && !canCsv) return null

  const copy = confirm ? CONFIRM_COPY[confirm] : null

  return (
    <div className="flex items-center gap-2" data-testid="invoice-actions" data-status={status}>
      {canSend && (
        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setConfirm('send')}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Send
        </Button>
      )}
      {canMarkPaid && (
        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setConfirm('paid')}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Mark paid
        </Button>
      )}
      {canCsv && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          QBO CSV
        </Button>
      )}
      {canVoid && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
          onClick={() => setConfirm('void')}
        >
          <Ban className="h-3.5 w-3.5" aria-hidden />
          Void
        </Button>
      )}

      <Dialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-testid="invoice-action-dialog">
          {copy && (
            <>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>
                  {invoiceNumber} · {copy.body}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={confirm === 'void' ? 'destructive' : 'default'}
                  disabled={pending}
                  onClick={() => void runConfirmed()}
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {copy.cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
