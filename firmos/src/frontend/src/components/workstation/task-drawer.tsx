'use client'

import * as React from 'react'
import { BookOpen, CalendarCheck, ExternalLink, ListChecks, MessageSquare, StickyNote, Video } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { CloseStepSegments, closeStepTitleKey } from '@/components/clients/close-stepper'
import type { TaskDetail, TaskDetailSop } from '@/server/task-detail'
import type { CloseStepKey, CloseSteps } from '@/server/year-grid'
import { avatarStyle } from '@/shared/lib/avatar-hue'
import { dueAging, monthLabel, periodLabel, stampLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

import { KIND_META, KIND_STYLE, TaskTimerToggle } from './work-card'

/**
 * Task detail drawer (owner call notes: "each task has potential to have an
 * SOP assigned to it... so I never have to retrain"). Opens from task-kind
 * work cards; the server read (getTaskDetail) gathers subtasks, the notes
 * thread, and the linked SOPs (direct + via the originating recurring rule).
 *
 * Every SOP card carries the staleness failsafe: "Updated {date}" plus the
 * change note when present, so staff can see at a glance whether the
 * procedure they are about to follow is current.
 */

const TASK_STATUS_BADGE: Record<string, { status: WorkStatus; label: string }> = {
  new: { status: 'on_track', label: 'New' },
  open: { status: 'on_track', label: 'Open' },
  pending: { status: 'on_track', label: 'Pending' },
  not_started: { status: 'on_track', label: 'Not started' },
  in_progress: { status: 'due_soon', label: 'In progress' },
  waiting_on_client: { status: 'waiting_client', label: 'Waiting on client' },
  blocked: { status: 'on_hold', label: 'Blocked' },
  cancelled: { status: 'on_hold', label: 'Cancelled' },
  completed: { status: 'on_track', label: 'Completed' },
}

function isVideoLink(url: string): boolean {
  return /loom\.com|youtube\.com|youtu\.be|vimeo\.com/i.test(url)
}

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return isVideoLink(url) ? `Watch the walkthrough (${host})` : host
  } catch {
    return url
  }
}

/** One linked SOP as a readable procedure card. */
function SopCard({ sop }: { sop: TaskDetailSop }) {
  // Content lines become the step list; bare URLs drop out of the steps and
  // render as their own link row below.
  const steps = (sop.content ?? '')
    .split('\n')
    .map((line) => line.replace(/https?:\/\/[^\s)>"']+/g, '').trim())
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((line) => line !== '')

  return (
    <article data-testid="sop-card" className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug text-foreground">{sop.title}</h4>
        {sop.institutionKey && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {sop.institutionKey}
          </span>
        )}
      </div>
      <p className="tnum mt-1 text-[11px] text-muted-foreground" data-testid="sop-updated">
        Updated {stampLabel(sop.updatedAt)}
        {sop.changeNote ? ` - ${sop.changeNote}` : ''}
      </p>
      {steps.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground">
              <span className="tnum mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {sop.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sop.links.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="sop-link"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
            >
              {isVideoLink(url) ? (
                <Video className="h-3 w-3 text-muted-foreground" aria-hidden />
              ) : (
                <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
              )}
              {linkLabel(url)}
            </a>
          ))}
        </div>
      )}
    </article>
  )
}

function SectionHeading({ icon: Icon, children }: { icon: typeof BookOpen; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </h3>
  )
}

interface TaskDrawerProps {
  /** The task-kind card id; null closes the drawer. */
  taskId: number | null
  open: boolean
  /** The card the drawer opened from: client + period + title, used to show
   *  the guided-close stepper in context for recurring close-step tasks. */
  closeContext?: {
    clientId: number
    year: number | null
    month: number | null
    title: string
  } | null
  onOpenChange: (open: boolean) => void
  /** Complete/re-open delegates to the queue's optimistic mutation. */
  onToggleComplete: (completed: boolean) => void
}

export function TaskDrawer({ taskId, open, closeContext = null, onOpenChange, onToggleComplete }: TaskDrawerProps) {
  const [detail, setDetail] = React.useState<TaskDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [noteDraft, setNoteDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [closeSteps, setCloseSteps] = React.useState<CloseSteps | null>(null)

  // Month-close context: only recurring close-step tasks (Categorize /
  // Reconcile / Client Questions / Send Reports) get the stepper strip.
  const ctxClientId = closeContext?.clientId ?? null
  const ctxYear = closeContext?.year ?? null
  const ctxMonth = closeContext?.month ?? null
  const stepKey: CloseStepKey | null = closeContext ? closeStepTitleKey(closeContext.title) : null

  React.useEffect(() => {
    setCloseSteps(null)
    if (!open || stepKey == null || ctxClientId == null || ctxYear == null || ctxMonth == null) return
    let cancelled = false
    void (async () => {
      try {
        // Dynamic import: the actions module pulls in @/db, and drawer jsdom
        // tests render without a database (same seam as the detail read).
        const m = await import('@/server/actions/close-steps')
        const res = await m.getCloseStepsAction(ctxClientId, ctxYear, ctxMonth)
        if (!cancelled && res.ok) setCloseSteps(res.data)
      } catch {
        // No server reach in tests; the context strip simply stays hidden.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, stepKey, ctxClientId, ctxYear, ctxMonth])

  const refresh = React.useCallback(async (id: number) => {
    // Dynamic import: the actions module pulls in @/db, and queue/drawer
    // jsdom tests render without a database (same seam as the card toggle).
    const m = await import('@/server/actions/tasks')
    const res = await m.getTaskDetailAction(id)
    if (res.ok) {
      setDetail(res.data)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [])

  React.useEffect(() => {
    if (open && taskId != null) {
      setDetail(null)
      setError(null)
      setNoteDraft('')
      void refresh(taskId)
    }
  }, [open, taskId, refresh])

  async function toggleSubtask(subtaskId: number, completed: boolean) {
    if (taskId == null) return
    // Optimistic: flip locally, roll back on failure.
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            subtasks: prev.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted: completed } : s)),
          }
        : prev,
    )
    const m = await import('@/server/actions/tasks')
    const res = await m.setSubtaskCompletedAction(subtaskId, completed)
    if (!res.ok) {
      toast.error(res.error)
      void refresh(taskId)
    }
  }

  async function addNote() {
    if (taskId == null || noteDraft.trim() === '') return
    setBusy(true)
    const m = await import('@/server/actions/tasks')
    const res = await m.addTaskNoteAction(taskId, noteDraft)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setNoteDraft('')
    void refresh(taskId)
  }

  const task = detail?.task ?? null
  const badge = task ? (TASK_STATUS_BADGE[task.status] ?? { status: 'on_track' as WorkStatus, label: task.status }) : null
  const aging = detail && task ? dueAging(task.dueDate, detail.today) : null
  const isCompleted = task?.status === 'completed'
  const assigneeInitials =
    task?.assigneeName
      ?.split(/\s+/)
      .map((p) => p[0] ?? '')
      .join('')
      .toUpperCase() ?? null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="task-drawer" aria-label="Task detail">
        {error != null && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-semibold text-foreground">Couldn’t load this task.</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        )}
        {error == null && detail == null && (
          <SheetHeader className="border-b border-border p-5">
            <SheetTitle>Loading task…</SheetTitle>
            <SheetDescription>Fetching the detail, checklist, and linked SOPs.</SheetDescription>
          </SheetHeader>
        )}
        {error == null && detail != null && task != null && badge != null && aging != null && (
          <>
            <SheetHeader className="gap-2 border-b border-border p-5 pr-10">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                    KIND_STYLE.task.chip,
                  )}
                >
                  <KIND_META.task.Icon className="h-3 w-3" aria-hidden />
                  {KIND_META.task.label}
                </span>
                <WorkStatusBadge status={badge.status} label={badge.label} />
                <span
                  className={cn(
                    'tnum rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    KIND_STYLE.task.chip,
                  )}
                >
                  {periodLabel(task.attributedYear, task.attributedMonth)}
                </span>
              </div>
              <SheetTitle data-testid="task-drawer-title">{task.title}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {task.clientName && <span className="font-medium">{task.clientName}</span>}
                  <span
                    className={cn(
                      'tnum font-medium',
                      aging.tone === 'overdue' && 'text-status-overdue',
                      aging.tone === 'today' && 'text-status-due-soon',
                      (aging.tone === 'future' || aging.tone === 'none') && 'text-muted-foreground',
                    )}
                  >
                    {aging.label}
                  </span>
                  {task.assigneeName && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Avatar className="h-4 w-4">
                        <AvatarFallback
                          className="text-[8px] font-semibold"
                          style={task.assigneeId != null ? avatarStyle(task.assigneeId) : undefined}
                        >
                          <span className="sr-only">{task.assigneeName}</span>
                          <span aria-hidden>{assigneeInitials}</span>
                        </AvatarFallback>
                      </Avatar>
                      {task.assigneeName}
                    </span>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {closeSteps != null && stepKey != null && (
                <section aria-label="Month close" className="space-y-2" data-testid="drawer-close-steps">
                  <SectionHeading icon={CalendarCheck}>
                    Month close - {monthLabel(closeSteps.year, closeSteps.month)}
                  </SectionHeading>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <CloseStepSegments steps={closeSteps.steps} currentKey={stepKey} />
                    {closeSteps.allDone && (
                      <p className="mt-2 text-center text-[11px] font-medium text-status-on-track">
                        Books closed for {monthLabel(closeSteps.year, closeSteps.month)}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {task.description && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{task.description}</p>
              )}

              <section aria-label="Checklist" className="space-y-2">
                <SectionHeading icon={ListChecks}>
                  Checklist
                  <span className="tnum font-semibold">
                    {detail.subtasks.filter((s) => s.isCompleted).length}/{detail.subtasks.length}
                  </span>
                </SectionHeading>
                {detail.subtasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No checklist items on this task.</p>
                ) : (
                  <ul className="space-y-1">
                    {detail.subtasks.map((s) => (
                      <li key={s.id}>
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors duration-150 hover:bg-muted/60"
                          data-testid="subtask-row"
                        >
                          <Checkbox
                            checked={s.isCompleted}
                            onCheckedChange={(c) => void toggleSubtask(s.id, c === true)}
                            aria-label={s.title}
                          />
                          <span className={cn(s.isCompleted && 'text-muted-foreground line-through')}>
                            {s.title}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label="SOPs" className="space-y-2">
                <SectionHeading icon={BookOpen}>SOPs</SectionHeading>
                {detail.sops.length === 0 && detail.manualEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No SOPs linked to this task. Link one from the SOP template admin, or set an
                    institution key to auto-link by account.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {detail.sops.map((sop) => (
                      <SopCard key={sop.id} sop={sop} />
                    ))}
                    {detail.manualEntries.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Client manual
                        </p>
                        {detail.manualEntries.map((entry) => (
                          <article
                            key={entry.id}
                            data-testid="manual-entry"
                            className="rounded-lg border border-border bg-card p-3"
                          >
                            <h4 className="text-sm font-semibold text-foreground">{entry.title}</h4>
                            <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                              Updated {stampLabel(entry.updatedAt)}
                            </p>
                            {entry.content && (
                              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                                {entry.content}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section aria-label="Notes" className="space-y-2">
                <SectionHeading icon={MessageSquare}>Notes</SectionHeading>
                {detail.notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No notes yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.notes.map((n) => (
                      <li key={n.id} data-testid="note-row" className="rounded-lg bg-muted/50 px-3 py-2">
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{n.body}</p>
                        <p className="tnum mt-1 text-[11px] text-muted-foreground">
                          {n.authorName} · {stampLabel(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-1.5">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="Add a note…"
                    aria-label="Add a note"
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={busy || noteDraft.trim() === ''}
                    onClick={() => void addNote()}
                  >
                    <StickyNote className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Add note
                  </Button>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border p-4">
              <div className="flex items-center gap-2">
                <TaskTimerToggle taskId={task.id} taskTitle={task.title} revealed />
                <span className="text-xs text-muted-foreground">Task timer</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant={isCompleted ? 'outline' : 'default'}
                data-testid="drawer-complete-toggle"
                onClick={() => {
                  onToggleComplete(!isCompleted)
                  onOpenChange(false)
                }}
              >
                {isCompleted ? 'Re-open task' : 'Complete task'}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
