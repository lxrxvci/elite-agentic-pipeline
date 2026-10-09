'use client'

import { useEffect, useMemo, useState } from 'react'
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
import type { ConversionTaskPlanItem } from '@/server/convert'

export interface StaffOption {
  id: number
  name: string
  /** E13: current open assigned work count ("don't overload one person"). */
  openCount?: number
}

/** "Sofia Lindqvist (12 open)" when the workload count is available. */
export function staffOptionLabel(o: StaffOption): string {
  return o.openCount == null ? o.name : `${o.name} (${o.openCount} open)`
}

const selectCls =
  'h-10 w-full appearance-none rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Convert-to-client confirmation (HANDOFF §6.8): conversion is a
 * manager-and-above decision. Staff assignment is optional here (owner call
 * notes: assignment is a post-conversion admin action on the client record);
 * server errors (bad state, concurrent conversion) render verbatim as human
 * messages.
 *
 * L6 (I4/I5, 10_06 00:59:13): "once we convert… we'll do the task
 * assigning, we'll finalize the days of the week." The dialog lists the
 * engagement's scheduled tasks with a per-task employee picker (defaulting
 * to the seat picks above) and each candidate's open-work count as the
 * staggering hint. Days carry over from the proposed schedule.
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
  // L6 (I5): the per-task plan loads on open (lazy - the dialog is rare).
  const [plan, setPlan] = useState<ConversionTaskPlanItem[] | null>(null)
  const [planLoaded, setPlanLoaded] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || planLoaded) return
    let cancelled = false
    void (async () => {
      const { getConversionTaskPlan } = await import('@/server/actions/intake')
      const res = await getConversionTaskPlan(intakeId)
      if (cancelled) return
      setPlanLoaded(true)
      if (res.ok) setPlan(res.data.items.length > 0 ? res.data.items : null)
    })()
    return () => {
      cancelled = true
    }
  }, [open, intakeId, planLoaded])

  const employees = useMemo(() => [...managers, ...bookkeepers], [managers, bookkeepers])
  /** A row's effective assignee: its explicit pick, else the seat default. */
  const rowValue = (item: ConversionTaskPlanItem): string =>
    picked[item.key] ?? (item.seat === 'manager' ? managerId : bookkeeperId)
  const openCountOf = (v: string): number | null =>
    v === '' ? null : (employees.find((e) => String(e.id) === v)?.openCount ?? null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    // L6 (I5): explicit per-task picks ride the conversion (empty rows fall
    // back to the seat default server-side).
    const taskAssignees: Record<string, number> = {}
    for (const item of plan ?? []) {
      const v = rowValue(item)
      if (v !== '') taskAssignees[item.key] = Number(v)
    }
    const res = await convertIntake(intakeId, {
      managerId: managerId === '' ? null : Number(managerId),
      bookkeeperId: bookkeeperId === '' ? null : Number(bookkeeperId),
      taskAssignees,
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
                  {staffOptionLabel(m)}
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
                  {staffOptionLabel(b)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* L6 (I5): per-task assignment with the workload hint - "see what
            the admin's schedule looks like" before committing. */}
        {plan && plan.length > 0 && (
          <div className="mt-2" data-testid="convert-task-plan">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Task assignment <span className="font-normal">(days carry over from the proposed schedule)</span>
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {plan.map((item) => {
                const v = rowValue(item)
                const open = openCountOf(v)
                return (
                  <li
                    key={item.key}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                    data-testid={`convert-task-${item.key}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{item.cadence}</span>
                    </span>
                    <select
                      aria-label={`Assign ${item.title}`}
                      data-testid={`convert-task-assignee-${item.key}`}
                      className="h-8 w-40 appearance-none rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      value={v}
                      onChange={(e) => setPicked((p) => ({ ...p, [item.key]: e.target.value }))}
                    >
                      <option value="">Assign later</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <span className="tnum w-14 shrink-0 text-right text-[10px] text-muted-foreground" data-testid={`convert-task-load-${item.key}`}>
                      {open == null ? '' : `${open} open`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Anything left unassigned can be staffed after conversion from the client record.
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
