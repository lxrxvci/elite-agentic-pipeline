'use client'

import * as React from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import type { WorkCard } from '@/server/queue'

/**
 * D7/L3 - request a bumper-lane override on a locked card. The reason is
 * required (the approver reads it in /admin/purgatory); the engine re-checks
 * that the card is actually locked for the requester and that no request is
 * already pending.
 */
export function RequestOverrideDialog({
  card,
  open,
  onOpenChange,
  onRequested,
}: {
  /** The lane-locked card; null while closed. */
  card: WorkCard | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After a successful request (the parent refreshes the queue). */
  onRequested: () => void
}) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  async function submit() {
    if (card == null) return
    setBusy(true)
    try {
      // Dynamic import: the actions module pulls in @/db, and jsdom tests
      // render without a database (same seam as the task drawer).
      const m = await import('@/server/actions/approvals')
      const res = await m.requestBumperOverrideAction({ kind: card.kind, id: card.id }, reason)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
    } catch {
      toast.error('The request could not be sent - try again.')
      return
    } finally {
      setBusy(false)
    }
    toast.success('Override requested - a manager will review it')
    onOpenChange(false)
    onRequested()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="request-override-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request an override</DialogTitle>
          <DialogDescription>
            Bumper lanes lock this card until the current stage finishes. Ask a manager to unlock
            just this card for 24 hours.
          </DialogDescription>
        </DialogHeader>
        {card != null && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-sm font-medium text-foreground">{card.title}</p>
              <p className="text-xs text-muted-foreground">{card.clientName}</p>
              {card.laneLockReason && (
                <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                  {card.laneLockReason}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="override-reason" className="text-xs font-semibold text-foreground">
                Why do you need to jump ahead?
              </label>
              <Textarea
                id="override-reason"
                data-testid="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Client called - they need the report before Friday's board meeting"
                className="text-sm"
                autoFocus
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="override-submit"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {busy ? 'Requesting…' : 'Request override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
