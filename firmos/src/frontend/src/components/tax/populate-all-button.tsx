'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { toast } from 'sonner'

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
import { populateAllChecklistsAction } from '@/server/actions/tax'

/**
 * §18 December workflow: populate the year-end checklist for every active
 * client at once. Confirmed before running; the engine is idempotent, so a
 * re-run only fills gaps.
 */
export function PopulateAllButton({ year }: { year: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    const res: { ok: boolean; error?: string; data?: { clientsProcessed: number; itemsCreated: number } } =
      await populateAllChecklistsAction(year)
    setRunning(false)
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return
    }
    setOpen(false)
    toast.success(
      `Populated ${year} checklists: ${res.data.clientsProcessed} clients, ${res.data.itemsCreated} new items`,
    )
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" data-testid="populate-all-button">
          <ListChecks aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Populate all checklists
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Populate {year} checklists</DialogTitle>
          <DialogDescription>
            Creates the year-end checklist for every active client from the firm templates. Clients
            already populated keep their progress - only missing items are added.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={run} disabled={running}>
            {running ? 'Populating...' : 'Populate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
