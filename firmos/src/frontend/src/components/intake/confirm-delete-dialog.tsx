'use client'

import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * L1 (H3/H4, 10_06 00:31:41 + 00:41:21): "anything that's deleting data,
 * there should be a warning to delete anywhere in the system." One shared
 * confirmation for every delete affordance: names the item and spells out
 * the consequence before the destructive button arms.
 */
export function ConfirmDeleteDialog({
  open,
  itemName,
  consequence,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  open: boolean
  /** The thing being removed, quoted back ("Walk my dog (weekly)"). */
  itemName: string
  /** What deleting it affects ("this removes the routine from the schedule and its estimate line"). */
  consequence?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent data-testid="confirm-delete-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
            Delete {itemName}?
          </DialogTitle>
          <DialogDescription>
            {consequence ?? 'This cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" data-testid="confirm-delete-cancel" onClick={onCancel}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="confirm-delete-confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
