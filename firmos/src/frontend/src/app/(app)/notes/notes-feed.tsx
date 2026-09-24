'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, ListPlus, StickyNote, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PickerCombobox } from '@/components/quick-add/picker-combobox'
import { relativeTime } from '@/components/notifications/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  addQuickNoteAction,
  createTaskFromNoteAction,
  deleteQuickNoteAction,
  setQuickNoteCompletedAction,
} from '@/server/actions/quick-add'
import type { QuickNoteFeedItem, QuickNotePriority } from '@/server/quick-add'
import { cn } from '@/shared/lib/utils'

/**
 * The /notes feed: a "New note" composer on top (same minimal shape as the
 * quick-add dialog, plus optional priority and due date - E4) and the feed
 * below. Adds prepend optimistically from the action response; deletes and
 * completion toggles are optimistic with a toast on failure. Every note can
 * spin off a follow-up task prefilled from the note (client + title); the
 * note stamps completed when the task lands. Delete/complete controls render
 * only on the caller's own notes (server enforces the same).
 */

const PRIORITY_META: Record<QuickNotePriority, { label: string; cls: string | null }> = {
  low: { label: 'Low', cls: 'border-border text-muted-foreground' },
  normal: { label: 'Normal', cls: null }, // not rendered - normal is the silent default
  high: { label: 'High', cls: 'border-status-due-soon/50 bg-status-due-soon-bg text-status-due-soon' },
  urgent: { label: 'Urgent', cls: 'border-status-overdue/50 bg-status-overdue-bg text-status-overdue' },
}

function PriorityChip({ priority }: { priority: QuickNotePriority }) {
  const meta = PRIORITY_META[priority]
  if (meta.cls == null) return null
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', meta.cls)} data-testid="note-priority">
      {meta.label}
    </Badge>
  )
}

/** "Aug 30" style due-date label; overdue dates flag red. */
function DueChip({ dueDate, completed }: { dueDate: string; completed: boolean }) {
  const overdue = !completed && dueDate < new Date().toLocaleDateString('en-CA')
  return (
    <span
      data-testid="note-due"
      className={cn(
        'tnum inline-flex items-center gap-1',
        overdue ? 'font-medium text-status-overdue' : 'text-muted-foreground',
      )}
    >
      <CalendarClock className="h-3 w-3" aria-hidden />
      {dueDate}
      {overdue && ' (overdue)'}
    </span>
  )
}

// ── Follow-up task dialog (E4) ────────────────────────────────────────────

function FollowUpTaskDialog({
  note,
  clients,
  staff,
  onClose,
  onCreated,
}: {
  note: QuickNoteFeedItem | null
  clients: { id: number; name: string }[]
  staff: { id: number; name: string }[]
  onClose: () => void
  onCreated: (noteId: number) => void
}) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [assigneeId, setAssigneeId] = React.useState<number | null>(null)
  const [dueDate, setDueDate] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Prefill from the note every time a new one opens the dialog.
  React.useEffect(() => {
    if (note != null) {
      setTitle(note.body)
      setClientId(note.clientId)
      setAssigneeId(null)
      setDueDate(note.dueDate ?? '')
      setError(null)
    }
  }, [note])

  async function submit() {
    if (note == null) return
    if (clientId == null) {
      setError('Pick a client first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await createTaskFromNoteAction(note.id, {
        clientId,
        title,
        assigneeId,
        dueDate: dueDate === '' ? null : dueDate,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Follow-up task created', {
        description: 'The note is marked done.',
        action: { label: 'View', onClick: () => router.push(`/clients/${clientId}`) },
      })
      onCreated(note.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={note != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow-up task</DialogTitle>
          <DialogDescription>
            Prefilled from the note; creating it marks the note done.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="followup-title">Title</Label>
            <Textarea
              id="followup-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Client</Label>
              <PickerCombobox
                id="followup-client"
                label="Client"
                options={clients.map((c) => ({ id: c.id, label: c.name }))}
                value={clientId}
                onChange={setClientId}
                placeholder="Pick a client"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <PickerCombobox
                id="followup-assignee"
                label="Assignee"
                options={staff.map((s) => ({ id: s.id, label: s.name }))}
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="Pick a person"
                noneLabel="Unassigned"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="followup-due">Due date (optional)</Label>
            <Input
              id="followup-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          {error != null && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || title.trim() === '' || clientId == null}
            onClick={() => void submit()}
            data-testid="followup-create"
          >
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── The feed ──────────────────────────────────────────────────────────────

export function NotesFeed({
  initialNotes,
  clients,
  staff,
  currentUserId,
  currentUserName,
}: {
  initialNotes: QuickNoteFeedItem[]
  clients: { id: number; name: string }[]
  staff: { id: number; name: string }[]
  currentUserId: number
  currentUserName: string
}) {
  const [notes, setNotes] = React.useState<QuickNoteFeedItem[]>(initialNotes)
  const [body, setBody] = React.useState('')
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [priority, setPriority] = React.useState<QuickNotePriority>('normal')
  const [dueDate, setDueDate] = React.useState('')
  const [followUpSource, setFollowUpSource] = React.useState<QuickNoteFeedItem | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function addNote() {
    setBusy(true)
    try {
      const res = await addQuickNoteAction({
        clientId,
        body,
        priority,
        dueDate: dueDate === '' ? null : dueDate,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const clientName = clients.find((c) => c.id === clientId)?.name ?? null
      setNotes((prev) => [
        {
          id: res.data.id,
          body: res.data.body,
          clientId: res.data.clientId,
          clientName,
          authorId: currentUserId,
          authorName: currentUserName,
          createdAt: res.data.createdAt,
          priority: res.data.priority as QuickNotePriority,
          dueDate: res.data.dueDate,
          completedAt: null,
        },
        ...prev,
      ])
      setBody('')
      setClientId(null)
      setPriority('normal')
      setDueDate('')
      toast.success('Note added')
    } finally {
      setBusy(false)
    }
  }

  async function deleteNote(noteId: number) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    const res = await deleteQuickNoteAction(noteId)
    if (!res.ok) toast.error(res.error)
  }

  async function toggleComplete(note: QuickNoteFeedItem, completed: boolean) {
    const stamp = completed ? new Date() : null
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, completedAt: stamp } : n)))
    const res = await setQuickNoteCompletedAction(note.id, completed)
    if (!res.ok) {
      toast.error(res.error)
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, completedAt: note.completedAt } : n)))
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Textarea
          aria-label="New note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a quick note…"
          rows={3}
          className="text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-56">
            <PickerCombobox
              id="notes-feed-client"
              label="Client"
              options={clients.map((c) => ({ id: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Pick a client"
              noneLabel="Firm-wide"
            />
          </div>
          {/* E4: optional priority + due date; the defaults (normal, none)
              keep the two-tap flow intact. */}
          <select
            aria-label="Priority"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={priority}
            onChange={(e) => setPriority(e.target.value as QuickNotePriority)}
            data-testid="note-priority-select"
          >
            <option value="low">Low priority</option>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="urgent">Urgent</option>
          </select>
          <Input
            type="date"
            aria-label="Due date (optional)"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="tnum h-8 w-36 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="ml-auto h-8"
            disabled={busy || body.trim() === ''}
            onClick={() => void addNote()}
          >
            {busy ? 'Adding…' : 'Add note'}
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <StickyNote aria-hidden className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No notes yet</p>
          <p className="text-xs text-muted-foreground">
            Notes capture the context email loses: client quirks, QBO workarounds, handoff details.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="notes-feed">
          {notes.map((note) => {
            const done = note.completedAt != null
            return (
              <li
                key={note.id}
                data-testid="note-row"
                data-priority={note.priority}
                className={cn(
                  'group rounded-lg border border-border bg-card px-4 py-3',
                  done && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-2.5">
                  {note.authorId === currentUserId && (
                    <Checkbox
                      checked={done}
                      onCheckedChange={(c) => void toggleComplete(note, c === true)}
                      aria-label={done ? `Re-open note ${note.id}` : `Mark note ${note.id} done`}
                      className="mt-0.5"
                      data-testid="note-complete"
                    />
                  )}
                  <p
                    className={cn(
                      'min-w-0 flex-1 whitespace-pre-wrap text-sm text-foreground',
                      done && 'line-through',
                    )}
                  >
                    {note.body}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {note.clientName != null ? (
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      {note.clientName}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] font-medium text-muted-foreground">
                      Firm-wide
                    </Badge>
                  )}
                  <PriorityChip priority={note.priority} />
                  <span>{note.authorName}</span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(note.createdAt)}</span>
                  {note.dueDate != null && (
                    <>
                      <span aria-hidden>·</span>
                      <DueChip dueDate={note.dueDate} completed={done} />
                    </>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Create follow-up task from note ${note.id}`}
                      data-testid="note-followup"
                      onClick={() => setFollowUpSource(note)}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-firm-brand focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <ListPlus aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    {note.authorId === currentUserId && (
                      <button
                        type="button"
                        aria-label={`Delete note ${note.id}`}
                        onClick={() => void deleteNote(note.id)}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <FollowUpTaskDialog
        note={followUpSource}
        clients={clients}
        staff={staff}
        onClose={() => setFollowUpSource(null)}
        onCreated={(noteId) =>
          setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, completedAt: new Date() } : n)))
        }
      />
    </div>
  )
}
