'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DoorOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { setProjectTaskCompletedAction, startOffboardingAction } from '@/server/actions/templates'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge } from '@/shared/ui/work'

/**
 * Client Offboarding tab (§22). Starting offboarding creates the
 * "Offboarding" project with one task per active firm template. Tasks are
 * completed inline here; once every task is complete the engine
 * auto-finalizes: the project completes and the client goes inactive.
 */

export interface OffboardingTaskItem {
  id: number
  title: string
  isCompleted: boolean
  assigneeName: string | null
}

export interface OffboardingState {
  projectId: number
  projectStatus: string
  tasks: OffboardingTaskItem[]
}

interface OffboardingPanelProps {
  clientId: number
  clientName: string
  clientActive: boolean
  /** admin/owner or the client's manager (server decides). */
  canStart: boolean
  offboarding: OffboardingState | null
}

export function OffboardingPanel({ clientId, clientName, clientActive, canStart, offboarding }: OffboardingPanelProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())

  async function start() {
    setStarting(true)
    const res: { ok: boolean; error?: string; data?: { tasksCreated: number } } =
      await startOffboardingAction(clientId)
    setStarting(false)
    if (!res.ok || !res.data) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return
    }
    setOpen(false)
    toast.success(`Offboarding started - ${res.data.tasksCreated} tasks created`)
    router.refresh()
  }

  if (!offboarding) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <DoorOpen className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">
          {clientActive ? 'Offboarding not started' : 'Client is inactive'}
        </h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          {clientActive
            ? 'Starting offboarding creates the offboarding project from the firm templates. When every task completes, the client is automatically deactivated.'
            : 'This client has been deactivated. Historical records stay on file.'}
        </p>
        {clientActive && canStart && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" className="mt-4" data-testid="start-offboarding-button">
                Start offboarding
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Start offboarding for {clientName}?</DialogTitle>
                <DialogDescription>
                  This creates the Offboarding project with the firm&apos;s offboarding tasks and
                  notifies the client&apos;s manager and bookkeeper. The client is deactivated only
                  after every task is complete.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={start} disabled={starting} data-testid="confirm-start-offboarding">
                  {starting ? 'Starting...' : 'Start offboarding'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    )
  }

  const done = offboarding.tasks.filter((t) => t.isCompleted).length
  const finalized = offboarding.projectStatus === 'completed'

  // §22 - checking the last task finalizes offboarding server-side and the
  // refresh shows the deactivated state. Toggle failures roll back via refresh.
  async function toggle(taskId: number, completed: boolean) {
    setPendingIds((prev) => new Set(prev).add(taskId))
    const res: { ok: boolean; error?: string } = await setProjectTaskCompletedAction(taskId, completed)
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(taskId)
      return next
    })
    if (!res.ok) {
      toast.error(res.error ?? 'Something went wrong - try again.')
    }
    router.refresh()
  }

  return (
    <div className="space-y-3" data-testid="offboarding-progress">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{done}</span> of{' '}
          <span className="tnum">{offboarding.tasks.length}</span> offboarding tasks complete
        </p>
        {finalized ? (
          <WorkStatusBadge status="on_track" label="Offboarding complete" />
        ) : (
          <WorkStatusBadge status="due_soon" label="Offboarding in progress" />
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {offboarding.tasks.map((task) => (
          <div
            key={task.id}
            data-testid="offboarding-row"
            className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-b-0"
          >
            <Checkbox
              checked={task.isCompleted}
              disabled={finalized || pendingIds.has(task.id)}
              onCheckedChange={(checked) => void toggle(task.id, checked === true)}
              aria-label={task.title}
            />
            <p
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-medium',
                task.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
              )}
            >
              {task.title}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {task.assigneeName ?? 'Unassigned'}
            </span>
          </div>
        ))}
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        {finalized
          ? 'Every task completed - the client was automatically deactivated.'
          : 'When the last task completes, offboarding finalizes automatically and the client is deactivated.'}
      </p>
    </div>
  )
}
