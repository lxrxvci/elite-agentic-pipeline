'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { convertIntake } from '@/server/actions/intake'

export interface StaffOption {
  id: number
  name: string
}

const selectCls =
  'h-10 w-full appearance-none rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Convert-to-client confirmation (HANDOFF §6.8): conversion is a
 * manager-and-above decision. Staff assignment is optional here (owner call
 * notes: assignment is a post-conversion admin action on the client record);
 * server errors (bad state, concurrent conversion) render verbatim as human
 * messages.
 */
export function ConvertDialog({
  intakeId,
  intakeName,
  managers,
  bookkeepers,
  open,
  onOpenChange,
}: {
  intakeId: number
  intakeName: string
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [managerId, setManagerId] = useState('')
  const [bookkeeperId, setBookkeeperId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const res = await convertIntake(intakeId, {
      managerId: managerId === '' ? null : Number(managerId),
      bookkeeperId: bookkeeperId === '' ? null : Number(bookkeeperId),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.success(`${intakeName} is now a client.`)
    onOpenChange(false)
    router.push(`/clients/${res.data.clientId}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="convert-dialog">
        <DialogHeader>
          <DialogTitle>Convert {intakeName} to a client</DialogTitle>
          <DialogDescription>
            This creates the client record, accounts, recurring work, and onboarding tasks in one
            step. It cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <label htmlFor="convert-manager" className="mb-1 block text-xs font-medium text-muted-foreground">
              Manager
            </label>
            <select
              id="convert-manager"
              data-testid="select-manager"
              className={selectCls}
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">Assign after conversion</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="convert-bookkeeper" className="mb-1 block text-xs font-medium text-muted-foreground">
              Bookkeeper
            </label>
            <select
              id="convert-bookkeeper"
              data-testid="select-bookkeeper"
              className={selectCls}
              value={bookkeeperId}
              onChange={(e) => setBookkeeperId(e.target.value)}
            >
              <option value="">Assign after conversion</option>
              {bookkeepers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          You can assign the team after conversion from the client record.
        </p>

        {error && (
          <p className="text-sm font-medium text-status-overdue" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={busy}
            data-testid="convert-confirm"
          >
            {busy ? 'Converting…' : 'Convert to client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
