'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
import { saveIntake } from '@/server/actions/intake'

/** Creates a draft intake (status new) and routes straight into the wizard. */
export function NewIntakeButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    if (name.trim().length === 0) {
      setError('Give the business a name first.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await saveIntake({ patch: { legalName: name.trim() } })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    setName('')
    router.push(`/intake/${res.data.intake.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="start-new-intake">Start new intake</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a new intake</DialogTitle>
          <DialogDescription>
            The wizard saves every answer as you go, so you can always pick it back up.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <label htmlFor="new-intake-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            Business legal name
          </label>
          <input
            id="new-intake-name"
            data-testid="new-intake-name"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            placeholder="Fern & Feather Floral Studio LLC"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && (
            <p className="mt-2 text-sm font-medium text-status-overdue" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0} data-testid="new-intake-create">
              {busy ? 'Creating…' : 'Start the wizard'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
