'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  addQuickNoteAction,
  logMeetingAction,
  mintFromTemplateAction,
  quickAddTaskAction,
} from '@/server/actions/quick-add'
import type { QuickAddOptions } from '@/server/quick-add'

import { PickerCombobox, type PickerOption } from './picker-combobox'

/**
 * The four quick-add dialogs (the "Y button" flows). Each is deliberately
 * minimal - one required field, everything else optional - so a note, task,
 * or meeting lands in seconds. Errors render inline (role="alert"); success
 * toasts carry a "View" link to wherever the new row surfaced.
 */

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: QuickAddOptions | null
}

const clientOptions = (options: QuickAddOptions | null): PickerOption[] =>
  (options?.clients ?? []).map((c) => ({ id: c.id, label: c.name }))

const staffOptions = (options: QuickAddOptions | null): PickerOption[] =>
  (options?.staff ?? []).map((s) => ({ id: s.id, label: s.name }))

const templateOptions = (options: QuickAddOptions | null): PickerOption[] =>
  (options?.templates ?? []).map((t) => ({ id: t.id, label: t.title, hint: `${t.dueInDays}d lead` }))

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {message}
    </p>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function viewAction(router: ReturnType<typeof useRouter>, href: string) {
  return { label: 'View', onClick: () => router.push(href) }
}

// ── Quick note ────────────────────────────────────────────────────────────

export function QuickNoteDialog({ open, onOpenChange, options }: DialogProps) {
  const router = useRouter()
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await addQuickNoteAction({ clientId, body })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Note added', { action: viewAction(router, '/notes') })
      setBody('')
      setClientId(null)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick note</DialogTitle>
          <DialogDescription>
            Sticky context for a client, or firm-wide when no client is picked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Client" htmlFor="quick-note-client">
            <PickerCombobox
              id="quick-note-client"
              label="Client"
              options={clientOptions(options)}
              value={clientId}
              onChange={setClientId}
              placeholder="Pick a client"
              noneLabel="Firm-wide"
              disabled={options == null}
            />
          </Field>
          <Field label="Note" htmlFor="quick-note-body">
            <Textarea
              id="quick-note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should you remember?"
              rows={3}
              autoFocus
              className="text-sm"
            />
          </Field>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || body.trim() === ''}
            onClick={() => void submit()}
          >
            {busy ? 'Adding…' : 'Add note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── New task ──────────────────────────────────────────────────────────────

export function QuickTaskDialog({ open, onOpenChange, options }: DialogProps) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [assigneeId, setAssigneeId] = React.useState<number | null>(null)
  const [dueDate, setDueDate] = React.useState('')
  const [subtasks, setSubtasks] = React.useState('')
  const [billable, setBillable] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit() {
    if (clientId == null) {
      setError('Pick a client first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await quickAddTaskAction({
        clientId,
        title,
        assigneeId,
        dueDate: dueDate === '' ? null : dueDate,
        subtasks: subtasks.split('\n'),
        billableStatus: billable ? 'billable' : 'non_billable',
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Task created', { action: viewAction(router, `/clients/${clientId}`) })
      setTitle('')
      setClientId(null)
      setAssigneeId(null)
      setDueDate('')
      setSubtasks('')
      setBillable(false)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>A one-off task on a client, with optional subtasks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title" htmlFor="quick-task-title">
            <Input
              id="quick-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              autoFocus
              className="h-9 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client" htmlFor="quick-task-client">
              <PickerCombobox
                id="quick-task-client"
                label="Client"
                options={clientOptions(options)}
                value={clientId}
                onChange={setClientId}
                placeholder="Pick a client"
                disabled={options == null}
              />
            </Field>
            <Field label="Assignee" htmlFor="quick-task-assignee">
              <PickerCombobox
                id="quick-task-assignee"
                label="Assignee"
                options={staffOptions(options)}
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="Pick a person"
                noneLabel="Unassigned"
                disabled={options == null}
              />
            </Field>
          </div>
          <Field label="Due date" htmlFor="quick-task-due">
            <Input
              id="quick-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 text-sm"
            />
          </Field>
          <Field label="Subtasks" htmlFor="quick-task-subtasks">
            <Textarea
              id="quick-task-subtasks"
              value={subtasks}
              onChange={(e) => setSubtasks(e.target.value)}
              placeholder="One per line"
              rows={3}
              className="text-sm"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="quick-task-billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked === true)}
            />
            <Label htmlFor="quick-task-billable" className="font-normal">
              Billable
            </Label>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || title.trim() === '' || clientId == null}
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Task from template ────────────────────────────────────────────────────

export function TemplateTaskDialog({ open, onOpenChange, options }: DialogProps) {
  const router = useRouter()
  const [templateId, setTemplateId] = React.useState<number | null>(null)
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const template = options?.templates.find((t) => t.id === templateId) ?? null

  async function submit() {
    if (templateId == null || clientId == null) {
      setError('Pick a template and a client first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await mintFromTemplateAction(templateId, clientId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success(`Task "${res.data.title}" created`, {
        action: viewAction(router, `/clients/${clientId}`),
      })
      setTemplateId(null)
      setClientId(null)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Task from template</DialogTitle>
          <DialogDescription>
            Mints one task from an ad-hoc template, with its default assignee and lead time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Template" htmlFor="quick-template-template">
            <PickerCombobox
              id="quick-template-template"
              label="Template"
              options={templateOptions(options)}
              value={templateId}
              onChange={setTemplateId}
              placeholder="Pick a template"
              disabled={options == null}
            />
          </Field>
          <Field label="Client" htmlFor="quick-template-client">
            <PickerCombobox
              id="quick-template-client"
              label="Client"
              options={clientOptions(options)}
              value={clientId}
              onChange={setClientId}
              placeholder="Pick a client"
              disabled={options == null}
            />
          </Field>
          {template != null && (
            <p className="text-xs text-muted-foreground">
              Due {template.dueInDays} days from today; assignee follows the template defaults.
            </p>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || templateId == null || clientId == null}
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Log meeting ───────────────────────────────────────────────────────────

export function LogMeetingDialog({ open, onOpenChange, options }: DialogProps) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [duration, setDuration] = React.useState('30')
  const [billable, setBillable] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit() {
    if (clientId == null) {
      setError('Pick a client first.')
      return
    }
    const durationMinutes = Number(duration)
    setBusy(true)
    setError(null)
    try {
      const res = await logMeetingAction({ clientId, title, durationMinutes, billable })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Meeting logged', {
        description: `${durationMinutes} min ${billable ? 'billable' : 'non-billable'}`,
        action: viewAction(router, `/clients/${clientId}`),
      })
      setTitle('')
      setClientId(null)
      setDuration('30')
      setBillable(true)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log meeting</DialogTitle>
          <DialogDescription>
            Records a completed task plus the time interval, so the hours land in reports.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="What was it about?" htmlFor="quick-meeting-title">
            <Input
              id="quick-meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quarterly review, QBO cleanup…"
              autoFocus
              className="h-9 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client" htmlFor="quick-meeting-client">
              <PickerCombobox
                id="quick-meeting-client"
                label="Client"
                options={clientOptions(options)}
                value={clientId}
                onChange={setClientId}
                placeholder="Pick a client"
                disabled={options == null}
              />
            </Field>
            <Field label="Duration (min)" htmlFor="quick-meeting-duration">
              <Input
                id="quick-meeting-duration"
                type="number"
                min={1}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="quick-meeting-billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked === true)}
            />
            <Label htmlFor="quick-meeting-billable" className="font-normal">
              Billable
            </Label>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={busy || title.trim() === '' || clientId == null}
            onClick={() => void submit()}
          >
            {busy ? 'Logging…' : 'Log meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
