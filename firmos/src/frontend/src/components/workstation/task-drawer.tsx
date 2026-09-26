'use client'

import * as React from 'react'
import Link from 'next/link'
import { BookOpen, CalendarCheck, ExternalLink, FileText, Flag, ListChecks, MessageSquare, StickyNote, Video } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { CloseStepSegments, closeStepTitleKey } from '@/components/clients/close-stepper'
import type { ReportUploadActionData } from '@/server/actions/documents'
import type { ReportCardDetail, TaskDetail, TaskDetailSop, WorkCardSopDetail } from '@/server/task-detail'
import type { WorkCardKind } from '@/server/queue'
import type { CloseStepKey, CloseSteps } from '@/server/year-grid'
import { avatarStyle } from '@/shared/lib/avatar-hue'
import { closeStepHref, reportsSurfaceHref, workSurfaceHref } from '@/shared/lib/client-deep-links'
import { dueAging, monthLabel, periodLabel, stampLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'
import { WorkStatusBadge, type WorkStatus } from '@/shared/ui/work'

import { KIND_META, KIND_STYLE, TaskTimerToggle } from './work-card'
import { ReportUploadDropzone } from './report-upload'

/**
 * Task detail drawer (owner call notes: "each task has potential to have an
 * SOP assigned to it... so I never have to retrain"). Opens from task-kind
 * work cards; the server read (getTaskDetail) gathers subtasks, the notes
 * thread, and the linked SOPs (direct + via the originating recurring rule).
 *
 * I5 (the bank SOP learning center): bank-feed and reconciliation cards open
 * the same drawer in a lighter mode - getWorkCardSopDetail resolves the
 * institution SOPs for the card's bank, so "where statements live, check
 * images, portal quirks" surface exactly where the work happens. Cards whose
 * bank has no SOPs yet get a quiet empty state, never an error.
 *
 * The action-surface wave (owner walkthrough 01:39:05: "clicking it should
 * take you to where you finish that task"): the drawer stays the context
 * panel and gains the DO surface per kind. Report tasks and report cards get
 * the period's report-file dropzone (upload -> row completes -> the §6.3
 * sync closes the summary task) plus the deep link to the client's reports
 * surface; feed/recon cards get the deep link into the client's Work tab;
 * the month-close stepper's steps link to the same surfaces per period.
 *
 * Every SOP card carries the staleness failsafe: "Updated {date}" plus the
 * change note when present, so staff can see at a glance whether the
 * procedure they are about to follow is current. Manager+ can flag a SOP
 * stale right from the card - the flag is a changeNote marker and
 * deliberately does not bump the updated date.
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
function SopCard({
  sop,
  canFlagStale,
  onFlagged,
}: {
  sop: TaskDetailSop
  /** I5: manager+ (or can_edit_sops) sees the staleness flag. */
  canFlagStale: boolean
  onFlagged: () => void
}) {
  const [flagging, setFlagging] = React.useState(false)
  // Content lines become the step list; bare URLs drop out of the steps and
  // render as their own link row below.
  const steps = (sop.content ?? '')
    .split('\n')
    .map((line) => line.replace(/https?:\/\/[^\s)>"']+/g, '').trim())
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((line) => line !== '')
  const institutionLabel = sop.institutionName ?? sop.institutionKey

  async function flagStale() {
    if (flagging) return
    setFlagging(true)
    try {
      // Dynamic import: same seam as the other drawer actions (jsdom tests
      // render without a database).
      const m = await import('@/server/actions/templates')
      const res = await m.flagSopStaleAction(sop.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Flagged "${sop.title}" stale - it needs a refresh`)
      onFlagged()
    } finally {
      setFlagging(false)
    }
  }

  return (
    <article data-testid="sop-card" className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug text-foreground">{sop.title}</h4>
        {institutionLabel && (
          <span
            data-testid="sop-institution-chip"
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {institutionLabel} SOP
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="tnum text-[11px] text-muted-foreground" data-testid="sop-updated">
          Updated {stampLabel(sop.updatedAt)}
          {sop.changeNote ? ` - ${sop.changeNote}` : ''}
        </p>
        {/* I5 staleness flag: one click, writes the changeNote marker only. */}
        {canFlagStale && (
          <button
            type="button"
            data-testid="sop-flag-stale"
            disabled={flagging}
            onClick={() => void flagStale()}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Flag className="h-3 w-3" aria-hidden />
            {flagging ? 'Flagging…' : 'Flag stale'}
          </button>
        )}
      </div>
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
  /** The open card: task-kind cards get the full detail read; bank-feed and
   *  reconciliation cards get the lighter institution-SOP read (I5); report
   *  cards get the report action surface (upload + deep link). null closes
   *  the drawer. */
  card: { kind: WorkCardKind; id: number } | null
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
  /** The upload path completed the card server-side (report flow): the queue
   *  moves the card into its completed strip + rolls the D4 celebration
   *  WITHOUT re-calling the completion mutation. */
  onServerCompleted?: () => void
}

const DRAWER_KINDS = new Set<WorkCardKind>(['task', 'bank_feed', 'reconciliation', 'report'])

export function TaskDrawer({ card, open, closeContext = null, onOpenChange, onToggleComplete, onServerCompleted }: TaskDrawerProps) {
  const [detail, setDetail] = React.useState<TaskDetail | null>(null)
  const [cardDetail, setCardDetail] = React.useState<WorkCardSopDetail | null>(null)
  const [reportDetail, setReportDetail] = React.useState<ReportCardDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [noteDraft, setNoteDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [assignBusy, setAssignBusy] = React.useState(false)
  const [closeSteps, setCloseSteps] = React.useState<CloseSteps | null>(null)

  const isTaskCard = card?.kind === 'task'
  // Month-close context: only recurring close-step tasks (Categorize /
  // Reconcile / Client Questions / Send Reports) get the stepper strip.
  const ctxClientId = closeContext?.clientId ?? null
  const ctxYear = closeContext?.year ?? null
  const ctxMonth = closeContext?.month ?? null
  const stepKey: CloseStepKey | null = closeContext ? closeStepTitleKey(closeContext.title) : null

  const refreshCloseSteps = React.useCallback(async () => {
    if (stepKey == null || ctxClientId == null || ctxYear == null || ctxMonth == null) return
    try {
      // Dynamic import: the actions module pulls in @/db, and drawer jsdom
      // tests render without a database (same seam as the detail read).
      const m = await import('@/server/actions/close-steps')
      const res = await m.getCloseStepsAction(ctxClientId, ctxYear, ctxMonth)
      if (res.ok) setCloseSteps(res.data)
    } catch {
      // No server reach in tests; the context strip simply stays hidden.
    }
  }, [stepKey, ctxClientId, ctxYear, ctxMonth])

  React.useEffect(() => {
    setCloseSteps(null)
    if (!open || stepKey == null || ctxClientId == null || ctxYear == null || ctxMonth == null) return
    void refreshCloseSteps()
  }, [open, stepKey, ctxClientId, ctxYear, ctxMonth, refreshCloseSteps])

  const refresh = React.useCallback(async (target: { kind: WorkCardKind; id: number }) => {
    // Dynamic import: the actions module pulls in @/db, and queue/drawer
    // jsdom tests render without a database (same seam as the card toggle).
    if (target.kind === 'task') {
      const m = await import('@/server/actions/tasks')
      const res = await m.getTaskDetailAction(target.id)
      if (res.ok) {
        setDetail(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
      return
    }
    // Report cards: the action surface read (row state + the period's file).
    if (target.kind === 'report') {
      const m = await import('@/server/actions/tasks')
      const res = await m.getReportCardDetailAction(target.id)
      if (res.ok) {
        setReportDetail(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
      return
    }
    // I5: bank-feed / reconciliation cards resolve their institution SOPs.
    if (target.kind === 'bank_feed' || target.kind === 'reconciliation') {
      const m = await import('@/server/actions/tasks')
      const res = await m.getWorkCardSopDetailAction(target.kind, target.id)
      if (res.ok) {
        setCardDetail(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
    }
  }, [])

  React.useEffect(() => {
    // Primitive deps on purpose: the queue passes a fresh card object every
    // render, and re-fetching the drawer on unrelated re-renders would flash
    // the loading state (and hammer the read) every cursor move.
    const kind = card?.kind ?? null
    const id = card?.id ?? null
    if (open && kind != null && id != null && DRAWER_KINDS.has(kind)) {
      setDetail(null)
      setCardDetail(null)
      setReportDetail(null)
      setError(null)
      setNoteDraft('')
      void refresh({ kind, id })
    }
  }, [open, card?.kind, card?.id, refresh])

  async function toggleSubtask(subtaskId: number, completed: boolean) {
    if (card == null) return
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
      void refresh(card)
    }
  }

  async function addNote() {
    if (card == null || noteDraft.trim() === '') return
    setBusy(true)
    const m = await import('@/server/actions/tasks')
    const res = await m.addTaskNoteAction(card.id, noteDraft)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setNoteDraft('')
    void refresh(card)
  }

  // E13: inline reassignment; the server answer refreshes the drawer.
  async function assignTo(assigneeId: number | null) {
    if (card == null) return
    setAssignBusy(true)
    try {
      const m = await import('@/server/actions/tasks')
      const res = await m.assignTaskAction(card.id, assigneeId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Task reassigned')
      void refresh(card)
    } catch {
      toast.error('The assignment could not be saved - try again.')
    } finally {
      setAssignBusy(false)
    }
  }

  // The report flow (owner walkthrough 01:39:05): the file landed, the
  // server completed the period's open report rows, and - when that settled
  // the month - the §6.3 sync closed the "Send Reports" task. Reflect the
  // done state in the drawer; the queue strips/celebrates completed cards
  // without re-running the mutation (onServerCompleted).
  function handleReportUploaded(data: ReportUploadActionData) {
    const { document, completion } = data
    if (card?.kind === 'report') {
      if (completion.completedRowIds.includes(card.id)) {
        toast.success(`${document.fileName} uploaded - report complete`)
        onServerCompleted?.()
      } else {
        toast.success(`Uploaded ${document.fileName}`)
      }
    } else if (completion.summaryTaskCompleted) {
      toast.success(`${document.fileName} uploaded - reports done for the month`)
      onServerCompleted?.()
    } else {
      toast.success(`Uploaded ${document.fileName} - the report file is on file`)
    }
    // The stepper strip scores from the same engine: re-read so the Reports
    // segment flips to done in place.
    void refreshCloseSteps()
    if (card != null) void refresh(card)
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
      <SheetContent
        data-testid="task-drawer"
        aria-label={isTaskCard ? 'Task detail' : 'Work card detail'}
      >
        {error != null && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-semibold text-foreground">
              Couldn’t load this {isTaskCard ? 'task' : 'card'}.
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        )}
        {error == null && detail == null && cardDetail == null && reportDetail == null && (
          <SheetHeader className="border-b border-border p-5">
            <SheetTitle>{isTaskCard ? 'Loading task…' : 'Loading card…'}</SheetTitle>
            <SheetDescription>
              {isTaskCard
                ? 'Fetching the detail, checklist, and linked SOPs.'
                : card?.kind === 'report'
                  ? 'Fetching the report and its file state.'
                  : 'Fetching the bank SOPs for this card.'}
            </SheetDescription>
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
                  {/* E13: assign inline; every option shows its current open
                      work count so nobody gets overloaded by default. */}
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Avatar className="h-4 w-4">
                      <AvatarFallback
                        className="text-[8px] font-semibold"
                        style={task.assigneeId != null ? avatarStyle(task.assigneeId) : undefined}
                      >
                        <span className="sr-only">{task.assigneeName ?? 'Unassigned'}</span>
                        <span aria-hidden>{assigneeInitials ?? '–'}</span>
                      </AvatarFallback>
                    </Avatar>
                    <Select
                      value={task.assigneeId != null ? String(task.assigneeId) : 'none'}
                      onValueChange={(v) => void assignTo(v === 'none' ? null : Number(v))}
                      disabled={assignBusy}
                    >
                      <SelectTrigger
                        className="h-6 w-auto gap-1 border-none px-1 text-xs shadow-none"
                        aria-label="Assign task"
                        data-testid="task-assign-select"
                      >
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {detail.assignableStaff.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name} ({s.openCount} open)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </span>
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
                    {/* Every step links to the client's surface for that period
                        (owner: "clicking it should take you to where you finish
                        that task"); the state engine is unchanged. */}
                    <CloseStepSegments
                      steps={closeSteps.steps}
                      currentKey={stepKey}
                      hrefs={Object.fromEntries(
                        closeSteps.steps.map((s) => [
                          s.key,
                          closeStepHref(closeSteps.clientId, closeSteps.year, closeSteps.month, s.key),
                        ]),
                      )}
                    />
                    {closeSteps.allDone && (
                      <p className="mt-2 text-center text-[11px] font-medium text-status-on-track">
                        Books closed for {monthLabel(closeSteps.year, closeSteps.month)}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* §6.3 report gate: a report task's DO surface is the period's
                  file upload; the gate copy lives on the Complete button. */}
              {detail.reportGate != null && task.clientId != null && (
                <section aria-label="Report file" className="space-y-2" data-testid="drawer-report-section">
                  <SectionHeading icon={FileText}>
                    Report file - {monthLabel(detail.reportGate.year, detail.reportGate.month)}
                  </SectionHeading>
                  <ReportUploadDropzone
                    clientId={task.clientId}
                    year={detail.reportGate.year}
                    month={detail.reportGate.month}
                    uploadedFileName={detail.reportGate.fileName}
                    onUploaded={handleReportUploaded}
                  />
                  <Link
                    href={reportsSurfaceHref(task.clientId, {
                      year: detail.reportGate.year,
                      month: detail.reportGate.month,
                    })}
                    data-testid="reports-surface-link"
                    className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-firm-action transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Open this client’s Reports tab
                  </Link>
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
                      <SopCard
                        key={sop.id}
                        sop={sop}
                        canFlagStale={detail.canFlagStale}
                        onFlagged={() => card != null && void refresh(card)}
                      />
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
              {/* B4: a parent task cannot complete with an open checklist -
                  the server enforces it too; here the affordance explains it.
                  §6.3: a report task completes only once its report file is
                  uploaded - same pattern, the gate copy names the fix. */}
              {(() => {
                const openSubtasks = detail.subtasks.filter((s) => !s.isCompleted).length
                const reportGated =
                  !isCompleted && detail.reportGate != null && !detail.reportGate.documentUploaded
                const gated = !isCompleted && (openSubtasks > 0 || reportGated)
                return (
                  <div className="flex items-center gap-2">
                    {openSubtasks > 0 && !isCompleted && (
                      <span className="text-[11px] text-muted-foreground" data-testid="subtask-gate-note">
                        {openSubtasks} checklist item{openSubtasks === 1 ? '' : 's'} still open
                      </span>
                    )}
                    {reportGated && (
                      <span className="text-[11px] text-muted-foreground" data-testid="report-gate-note">
                        Upload the report file to complete
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={isCompleted ? 'outline' : 'default'}
                      data-testid="drawer-complete-toggle"
                      disabled={gated}
                      title={
                        reportGated
                          ? 'Upload the report file first'
                          : openSubtasks > 0 && !isCompleted
                            ? 'Finish the checklist first'
                            : undefined
                      }
                      onClick={() => {
                        onToggleComplete(!isCompleted)
                        onOpenChange(false)
                      }}
                    >
                      {isCompleted ? 'Re-open task' : 'Complete task'}
                    </Button>
                  </div>
                )
              })()}
            </div>
          </>
        )}

        {/* I5: bank-feed / reconciliation cards - the lighter learning-center
            read. Header + institution SOPs + the card's complete action; no
            checklist, notes, or timer (those belong to task cards). */}
        {error == null && !isTaskCard && cardDetail != null && card != null &&
          (() => {
            const cardKind = cardDetail.kind
            const meta = KIND_META[cardKind]
            const cardAging = dueAging(cardDetail.dueDate, cardDetail.today)
            // Section heading names the banks that actually have SOPs here
            // (a feed card can span several banks; the empty state below
            // names the uncovered ones).
            const matchedNames = [
              ...new Set(cardDetail.sops.map((s) => s.institutionName ?? s.institutionKey)),
            ].filter((n): n is string => n != null)
            const heading =
              matchedNames.length > 0 ? `${matchedNames.join(', ')} SOPs` : 'Bank SOPs'
            return (
              <>
                <SheetHeader className="gap-2 border-b border-border p-5 pr-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                        KIND_STYLE[cardKind].chip,
                      )}
                    >
                      <meta.Icon className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </span>
                    <span
                      className={cn(
                        'tnum rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        KIND_STYLE[cardKind].chip,
                      )}
                    >
                      {periodLabel(cardDetail.attributedYear, cardDetail.attributedMonth)}
                    </span>
                  </div>
                  <SheetTitle data-testid="task-drawer-title">{cardDetail.title}</SheetTitle>
                  <SheetDescription asChild>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {cardDetail.clientName && (
                        <span className="font-medium">{cardDetail.clientName}</span>
                      )}
                      <span
                        className={cn(
                          'tnum font-medium',
                          cardAging.tone === 'overdue' && 'text-status-overdue',
                          cardAging.tone === 'today' && 'text-status-due-soon',
                          (cardAging.tone === 'future' || cardAging.tone === 'none') &&
                            'text-muted-foreground',
                        )}
                      >
                        {cardAging.label}
                      </span>
                    </div>
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  {/* The DO surface for feed/recon work is the client's Work
                      tab (01:39:05) - one deep link lands on the card's own
                      period + stream drill-down. */}
                  <Link
                    href={workSurfaceHref(cardDetail.clientId, {
                      year: cardDetail.attributedYear,
                      month: cardDetail.attributedMonth,
                      stream: cardKind === 'bank_feed' ? 'bank_feeds' : 'reconciliations',
                    })}
                    data-testid="work-surface-link"
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:border-firm-action/60 hover:bg-firm-action-soft/40 hover:text-firm-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    {cardKind === 'bank_feed'
                      ? 'Open this week in the client’s Work tab'
                      : 'Open this month in the client’s Work tab'}
                  </Link>

                  <section aria-label="Bank SOPs" className="space-y-2">
                    <SectionHeading icon={BookOpen}>{heading}</SectionHeading>
                    {cardDetail.sops.length === 0 ? (
                      // Quiet empty state (I5): a bank with no SOPs yet is
                      // normal - the card just carries no badge, and this
                      // copy names who can close the gap.
                      <p className="text-xs text-muted-foreground" data-testid="sop-empty">
                        {cardDetail.hasInstitution
                          ? `No SOPs yet for ${cardDetail.institutionNames.join(', ')}. ` +
                            'The admin team can add one from the SOP templates page.'
                          : 'No bank on this account yet. Set the bank on the account and its SOPs will appear here automatically.'}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {cardDetail.sops.map((sop) => (
                          <SopCard
                            key={sop.id}
                            sop={sop}
                            canFlagStale={cardDetail.canFlagStale}
                            onFlagged={() => void refresh(card)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border p-4">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="drawer-complete-toggle"
                    onClick={() => {
                      onToggleComplete(true)
                      onOpenChange(false)
                    }}
                  >
                    Complete card
                  </Button>
                </div>
              </>
            )
          })()}

        {/* Report cards: the DO surface (01:39:05) - the period's report file
            upload (which completes the row server-side and lets the §6.3 sync
            close the "Send Reports" task), the deep link into the client's
            reports surface, and the plain complete/re-open arm. */}
        {error == null && card?.kind === 'report' && reportDetail != null &&
          (() => {
            const meta = KIND_META.report
            const reportAging = dueAging(reportDetail.dueDate, reportDetail.today)
            const isDone = reportDetail.completedAt != null
            return (
              <>
                <SheetHeader className="gap-2 border-b border-border p-5 pr-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                        KIND_STYLE.report.chip,
                      )}
                    >
                      <meta.Icon className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </span>
                    {isDone && <WorkStatusBadge status="on_track" label="Completed" />}
                    <span
                      className={cn(
                        'tnum rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        KIND_STYLE.report.chip,
                      )}
                    >
                      {periodLabel(reportDetail.attributedYear, reportDetail.attributedMonth)}
                    </span>
                  </div>
                  <SheetTitle data-testid="task-drawer-title">{reportDetail.title}</SheetTitle>
                  <SheetDescription asChild>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {reportDetail.clientName && (
                        <span className="font-medium">{reportDetail.clientName}</span>
                      )}
                      <span
                        className={cn(
                          'tnum font-medium',
                          reportAging.tone === 'overdue' && 'text-status-overdue',
                          reportAging.tone === 'today' && 'text-status-due-soon',
                          (reportAging.tone === 'future' || reportAging.tone === 'none') &&
                            'text-muted-foreground',
                        )}
                      >
                        {reportAging.label}
                      </span>
                    </div>
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                  <section aria-label="Report file" className="space-y-2" data-testid="drawer-report-section">
                    <SectionHeading icon={FileText}>
                      Report file - {monthLabel(reportDetail.attributedYear, reportDetail.attributedMonth)}
                    </SectionHeading>
                    <ReportUploadDropzone
                      clientId={reportDetail.clientId}
                      year={reportDetail.attributedYear}
                      month={reportDetail.attributedMonth}
                      uploadedFileName={reportDetail.documentFileName}
                      onUploaded={handleReportUploaded}
                    />
                    <Link
                      href={reportsSurfaceHref(reportDetail.clientId, {
                        year: reportDetail.attributedYear,
                        month: reportDetail.attributedMonth,
                      })}
                      data-testid="reports-surface-link"
                      className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-firm-action transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      Open this client’s Reports tab
                    </Link>
                  </section>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border p-4">
                  <Button
                    type="button"
                    size="sm"
                    variant={isDone ? 'outline' : 'default'}
                    data-testid="drawer-complete-toggle"
                    onClick={() => {
                      onToggleComplete(!isDone)
                      onOpenChange(false)
                    }}
                  >
                    {isDone ? 'Re-open card' : 'Complete card'}
                  </Button>
                </div>
              </>
            )
          })()}
      </SheetContent>
    </Sheet>
  )
}
