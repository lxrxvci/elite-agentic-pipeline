'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function UnsavedDraftDialog({
  open,
  itemLabel,
  addLabel,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean
  itemLabel: string
  addLabel: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent data-testid="unsaved-draft-dialog">
        <DialogHeader>
          <DialogTitle>Save this before continuing?</DialogTitle>
          <DialogDescription>
            You started adding {itemLabel} but never clicked &quot;{addLabel}&quot;.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="action" onClick={onSave} data-testid="unsaved-draft-save">
            Save and continue
          </Button>
          <Button type="button" variant="outline" onClick={onDiscard} data-testid="unsaved-draft-discard">
            Don&apos;t save
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="unsaved-draft-back">
            Go back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
