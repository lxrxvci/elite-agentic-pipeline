'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FilePenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitTimeEditAction } from '@/server/actions/time'
import { WorkStatusBadge } from '@/shared/ui/work'

import { activityLabel } from './format'

/**
 * "Request a time edit" flow (HANDOFF §17): a user cannot edit their own
 * recorded time - they submit corrected start/end plus a reason, which lands
 * in the admin review queue as pending. The chip states mirror the request
 * lifecycle: pending = due soon (action needed), approved = on track,
 * rejected = on hold (closed, no change).
 */

export interface EditableEntry {
  entryId: number
  activityType: string
  clientName: string | null
  startedAt: string
  endedAt: string | null
  editStatus: 'pending' | 'approved' | 'rejected' | 'cancelled' | null
}

function toInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TimeEditCell({ entry }: { entry: EditableEntry }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [start, setStart] = React.useState(() => toInputValue(entry.startedAt))
  const [end, setEnd] = React.useState(() => (entry.endedAt ? toInputValue(entry.endedAt) : ''))
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (entry.editStatus === 'pending') {
    return <WorkStatusBadge status="due_soon" label="Edit pending" />
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await submitTimeEditAction(
        entry.entryId,
        new Date(start).toISOString(),
        end ? new Date(end).toISOString() : null,
        reason.trim() || undefined,
      )
      if (result.ok) {
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Request edit for ${activityLabel(entry.activityType)} entry`}
        >
          <FilePenLine aria-hidden className="h-3.5 w-3.5" />
          Request edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a time edit</DialogTitle>
          <DialogDescription>
            {activityLabel(entry.activityType)}
            {entry.clientName ? ` · ${entry.clientName}` : ''} - an admin reviews the correction
            before it applies.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-start-${entry.entryId}`} className="text-xs">
                Corrected start
              </Label>
              <Input
                id={`edit-start-${entry.entryId}`}
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-end-${entry.entryId}`} className="text-xs">
                Corrected end
              </Label>
              <Input
                id={`edit-end-${entry.entryId}`}
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-reason-${entry.entryId}`} className="text-xs">
              Reason
            </Label>
            <Textarea
              id={`edit-reason-${entry.entryId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Forgot to clock out at lunch, system clocked me out early, ..."
              className="min-h-20 text-xs"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-overdue">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs">
              {busy ? 'Submitting...' : 'Submit request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
