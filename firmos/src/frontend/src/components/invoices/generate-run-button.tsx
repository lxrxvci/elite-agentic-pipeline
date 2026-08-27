'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play } from 'lucide-react'
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
import { generateMonthlyInvoicesAction } from '@/server/actions/invoices'
import { monthLabel } from '@/shared/lib/date-display'

/**
 * The monthly billing run (HANDOFF §6.5). The confirm dialog spells out
 * exactly what the run will do; the result toasts the engine's summary
 * verbatim (created / skipped / empty / failed).
 */
export function GenerateRunButton({
  year,
  month,
  pendingTaskCount,
}: {
  year: number
  month: number
  pendingTaskCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const label = monthLabel(year, month)

  async function run() {
    setPending(true)
    const res = await generateMonthlyInvoicesAction(year, month)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const s = res.data
    const skipped =
      s.skippedExisting + s.skippedCadence + s.skippedIneligible + s.skippedNoBilling
    const parts = [
      `${s.invoicesCreated} created`,
      `${skipped} skipped`,
      `${s.emptySkipped} empty not created`,
    ]
    if (s.tasksAttached > 0) parts.push(`${s.tasksAttached} billable tasks attached`)
    if (s.failures.length > 0) parts.push(`${s.failures.length} failed`)
    toast.success(`${label} billing run complete`, { description: parts.join(' · ') })
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
        data-testid="generate-run-button"
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        Generate monthly invoices
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="generate-run-dialog">
          <DialogHeader>
            <DialogTitle>Generate invoices for {label}?</DialogTitle>
            <DialogDescription>
              The billing run builds draft invoices from each client&apos;s services
              template, with quantities recomputed from live data.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
            <li>One draft invoice per eligible client for {label}, due Net 15.</li>
            <li>
              {pendingTaskCount > 0
                ? `${pendingTaskCount} unbilled completed task${pendingTaskCount === 1 ? '' : 's'} will be attached to the new drafts.`
                : 'No unbilled completed tasks to attach.'}
            </li>
            <li>Clients already invoiced for {label} are skipped, never duplicated.</li>
            <li>Invoices that would end up empty are not created.</li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={() => void run()}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Run for {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
