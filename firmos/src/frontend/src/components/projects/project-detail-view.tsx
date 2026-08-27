'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Link2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addProjectTaskAction,
  setProjectTaskDoneAction,
  updateProjectBillingAction,
  updateProjectStatusAction,
} from '@/server/actions/projects'
import type { ProjectDetail, ProjectTaskItem } from '@/server/projects'
import { dueAging } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge } from '@/shared/ui/work'

import { CompletionMeter } from './completion-meter'
import { MonthGrid } from './month-grid'
import { ProjectStatusChip, type ProjectStatusKey } from './project-status-chip'

/**
 * Project detail (HANDOFF §20): header (client, status, billing, completion)
 * plus the checklist. one_off rows complete via checkbox with prerequisite
 * chains enforced server-side; time_period rows render the 12-month grid.
 * Blocked rows show the chain ("After: X") and the on_hold token with the
 * checkbox disabled - the block is never color-alone.
 */

interface ProjectDetailViewProps {
  detail: ProjectDetail
  staff: { id: number; name: string }[]
  /** manager+ - billing mode edits (server re-guards). */
  canEditBilling: boolean
}

function OneOffRow({
  task,
  today,
  frozen,
}: {
  task: ProjectTaskItem
  today: string
  frozen: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const aging = dueAging(task.dueDate, today)
  const disabled = frozen || pending || task.blocked

  async function toggle(complete: boolean) {
    setPending(true)
    const res = await setProjectTaskDoneAction(task.id, complete)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  return (
    <div
      data-testid="project-task-row"
      data-task-id={task.id}
      data-blocked={task.blocked}
      className={cn(
        'flex min-h-12 items-center gap-3 px-4 py-2',
        task.blocked && 'bg-muted/30',
      )}
    >
      <Checkbox
        checked={task.isCompleted}
        disabled={disabled}
        onCheckedChange={(checked) => void toggle(checked === true)}
        aria-label={
          task.blocked
            ? `${task.title} - blocked until "${task.prerequisiteTitle}" is complete`
            : `Mark "${task.title}" ${task.isCompleted ? 'open' : 'done'}`
        }
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            task.isCompleted
              ? 'text-muted-foreground line-through'
              : task.blocked
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {task.title}
        </p>
        {task.prerequisiteTitle && (
          <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="prerequisite-note">
            After: {task.prerequisiteTitle}
          </p>
        )}
      </div>
      {task.blocked && <WorkStatusBadge status="on_hold" label="Blocked" />}
      {task.linkedTaskId != null && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Link2 className="h-3 w-3" aria-hidden />
          Linked task
        </span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {task.assignee?.name ?? 'Unassigned'}
      </span>
      <span
        className={cn(
          'tnum w-20 shrink-0 text-right text-[11px] font-semibold',
          task.isCompleted
            ? 'text-status-on-track'
            : aging.tone === 'overdue'
              ? 'text-status-overdue'
              : aging.tone === 'today'
                ? 'text-status-due-soon'
                : 'text-muted-foreground',
        )}
      >
        {task.isCompleted ? 'Done' : aging.label}
      </span>
    </div>
  )
}

function TimePeriodRow({ task, frozen }: { task: ProjectTaskItem; frozen: boolean }) {
  const done = task.periods.filter((p) => p.completed).length
  return (
    <div data-testid="project-task-row" data-task-id={task.id} data-blocked={task.blocked} className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-medium',
              task.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
            )}
          >
            {task.title}
          </p>
          {task.prerequisiteTitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="prerequisite-note">
              After: {task.prerequisiteTitle}
            </p>
          )}
        </div>
        {task.blocked && <WorkStatusBadge status="on_hold" label="Blocked" />}
        <span className="shrink-0 text-xs text-muted-foreground">
          {task.assignee?.name ?? 'Unassigned'}
        </span>
        <span
          className={cn(
            'tnum shrink-0 text-[11px] font-semibold',
            task.isCompleted ? 'text-status-on-track' : 'text-muted-foreground',
          )}
          data-testid="period-progress"
        >
          {done}/12 months
        </span>
      </div>
      <div className="mt-2">
        <MonthGrid taskId={task.id} periods={task.periods} disabled={frozen} />
      </div>
    </div>
  )
}

export function ProjectDetailView({ detail, staff, canEditBilling }: ProjectDetailViewProps) {
  const router = useRouter()
  const [pendingStatus, setPendingStatus] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'one_off' | 'time_period'>('one_off')
  const [prerequisiteId, setPrerequisiteId] = useState<string>('none')
  const [assigneeId, setAssigneeId] = useState<string>('none')
  const [dueDate, setDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  const frozen = detail.status === 'cancelled'
  const allDone = detail.tasksTotal > 0 && detail.tasksDone === detail.tasksTotal

  async function setStatus(status: ProjectStatusKey) {
    setPendingStatus(true)
    const res = await updateProjectStatusAction(detail.id, status)
    setPendingStatus(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  async function setBillingMode(billingMode: 'project' | 'tasks') {
    const res = await updateProjectBillingAction(detail.id, { billingMode })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  async function addTask() {
    const trimmed = title.trim()
    if (trimmed === '') return
    setAdding(true)
    const res = await addProjectTaskAction(detail.id, {
      title: trimmed,
      taskKind: kind,
      prerequisiteId: prerequisiteId === 'none' ? null : Number(prerequisiteId),
      assigneeId: assigneeId === 'none' ? null : Number(assigneeId),
      dueDate: dueDate === '' ? null : dueDate,
    })
    setAdding(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setTitle('')
    setPrerequisiteId('none')
    setAssigneeId('none')
    setDueDate('')
    toast.success('Task added')
    router.refresh()
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <header className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {detail.name}
              </h1>
              <ProjectStatusChip status={detail.status} size="md" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <Link href={`/clients/${detail.client.id}`} className="font-medium hover:text-foreground">
                {detail.client.name}
              </Link>
              {detail.templateName && ` · From template: ${detail.templateName}`}
              {detail.autoGenerateTasks && ' · Catch-up tasks auto-generated'}
            </p>
            {detail.description && (
              <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{detail.description}</p>
            )}
          </div>
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Billing
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">
                {canEditBilling ? (
                  <Select value={detail.billingMode} onValueChange={(v) => void setBillingMode(v as 'project' | 'tasks')}>
                    <SelectTrigger className="h-7 w-28 text-xs" aria-label="Billing mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Fixed price</SelectItem>
                      <SelectItem value="tasks">Per task</SelectItem>
                    </SelectContent>
                  </Select>
                ) : detail.billingMode === 'project' ? (
                  'Fixed price'
                ) : (
                  'Per task'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tasks
              </dt>
              <dd className="tnum mt-0.5 text-sm font-medium text-foreground">
                {detail.tasksDone}/{detail.tasksTotal}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Completion
              </dt>
              <dd className="mt-0.5">
                <CompletionMeter pct={detail.completionPct} status={detail.status} />
              </dd>
            </div>
          </dl>
        </div>

        {/* Status transitions (§20) - the engine re-guards every move. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {detail.status === 'pending' && (
            <Button type="button" size="sm" className="h-7 text-xs" disabled={pendingStatus} onClick={() => void setStatus('in_progress')}>
              Start project
            </Button>
          )}
          {detail.status === 'in_progress' && (
            <>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={pendingStatus || !allDone}
                onClick={() => void setStatus('completed')}
              >
                Mark complete
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={pendingStatus} onClick={() => void setStatus('cancelled')}>
                Cancel project
              </Button>
            </>
          )}
          {(detail.status === 'completed' || detail.status === 'cancelled') && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={pendingStatus} onClick={() => void setStatus('in_progress')}>
              Re-open project
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground">
            Completing every task completes the project automatically; re-opening one moves it back.
          </span>
        </div>
      </header>

      {/* Checklist */}
      {detail.tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-semibold text-foreground">No tasks yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Add checklist rows below. Time-period rows render a 12-month grid with per-period
            completion.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {detail.tasks.map((task) =>
            task.taskKind === 'time_period' ? (
              <TimePeriodRow key={task.id} task={task} frozen={frozen} />
            ) : (
              <OneOffRow key={task.id} task={task} today={detail.today} frozen={frozen} />
            ),
          )}
        </div>
      )}

      {/* Add task */}
      {!frozen && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addTask()
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task..."
            aria-label="Task title"
            className="h-8 min-w-52 flex-1 text-sm"
          />
          <Select value={kind} onValueChange={(v) => setKind(v as 'one_off' | 'time_period')}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Task kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one_off">One-off</SelectItem>
              <SelectItem value="time_period">Time period</SelectItem>
            </SelectContent>
          </Select>
          <Select value={prerequisiteId} onValueChange={setPrerequisiteId}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Prerequisite task">
              <SelectValue placeholder="No prerequisite" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No prerequisite</SelectItem>
              {detail.tasks.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  After: {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Assignee">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Due date"
            className="tnum h-8 w-36 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8" disabled={adding || title.trim() === ''}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Add task
          </Button>
        </form>
      )}
    </div>
  )
}
