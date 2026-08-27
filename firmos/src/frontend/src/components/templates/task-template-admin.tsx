'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createOnboardingTemplateAction,
  createOffboardingTemplateAction,
  createRecurringTemplateAction,
  deleteOnboardingTemplateAction,
  deleteOffboardingTemplateAction,
  deleteRecurringTemplateAction,
  updateOnboardingTemplateAction,
  updateOffboardingTemplateAction,
  updateRecurringTemplateAction,
} from '@/server/actions/templates'

import { ActiveState, ReadOnlyNote, RoleSelect, roleLabel } from './shared'

/**
 * Task-template admin for the three list-shaped systems (§19): recurring,
 * onboarding, offboarding. Recurring rows carry the schedule definition;
 * onboarding rows add the admin-phase flag (admin-phase tasks start new at
 * conversion, the rest blocked). Application happens elsewhere - recurring
 * at intake conversion, offboarding from the client record - so these
 * surfaces are pure CRUD.
 */

export type TaskTemplateKind = 'recurring' | 'onboarding' | 'offboarding'

export interface TaskTemplateItem {
  id: number
  title: string
  description: string | null
  defaultAssigneeRole: string | null
  position: number
  isActive: boolean
  /** recurring only. */
  scheduleType?: string
  dayOfMonth?: number | null
  /** onboarding only. */
  isAdminPhase?: boolean
}

const SCHEDULE_TYPES = ['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'] as const

const KIND_META: Record<
  TaskTemplateKind,
  {
    noun: string
    flag: string
    applicationNote: string
  }
> = {
  recurring: {
    noun: 'recurring template',
    flag: 'can_edit_task_templates',
    applicationNote:
      'Recurring templates become each client\u2019s Reconcile / Categorize / Client Questions / Send Reports rules at onboarding - they are never applied directly.',
  },
  onboarding: {
    noun: 'onboarding template',
    flag: 'can_edit_task_templates',
    applicationNote:
      'Onboarding templates are copied onto the client record at intake conversion. Admin-phase tasks start immediately; the rest start blocked.',
  },
  offboarding: {
    noun: 'offboarding template',
    flag: 'can_edit_task_templates',
    applicationNote:
      'Offboarding templates become the Offboarding project\u2019s tasks when offboarding starts from the client record.',
  },
}

interface TaskTemplateAdminProps {
  kind: TaskTemplateKind
  items: TaskTemplateItem[]
  /** can_edit_task_templates or owner/admin (decided server-side). */
  canEdit: boolean
}

export function TaskTemplateAdmin({ kind, items, canEdit }: TaskTemplateAdminProps) {
  const router = useRouter()
  const meta = KIND_META[kind]
  const [editTarget, setEditTarget] = useState<TaskTemplateItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [position, setPosition] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [scheduleType, setScheduleType] = useState<string>('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('')
  const [isAdminPhase, setIsAdminPhase] = useState(false)

  function openForm(target: TaskTemplateItem | null) {
    setEditTarget(target)
    setTitle(target?.title ?? '')
    setDescription(target?.description ?? '')
    setRole(target?.defaultAssigneeRole ?? null)
    setPosition(String(target?.position ?? 0))
    setIsActive(target?.isActive ?? true)
    setScheduleType(target?.scheduleType ?? 'monthly')
    setDayOfMonth(target?.dayOfMonth != null ? String(target.dayOfMonth) : '')
    setIsAdminPhase(target?.isAdminPhase ?? false)
    setFormOpen(true)
  }

  async function save() {
    setBusy(true)
    // The actions' success arms widen ok to boolean; type the union locally.
    let res: { ok: boolean; error?: string }
    if (kind === 'recurring') {
      const payload = {
        title,
        description: description || null,
        scheduleType: scheduleType as (typeof SCHEDULE_TYPES)[number],
        dayOfMonth: dayOfMonth === '' ? null : Number(dayOfMonth),
        defaultAssigneeRole: role,
        position: Number(position) || 0,
        isActive,
      }
      res = editTarget
        ? await updateRecurringTemplateAction(editTarget.id, payload)
        : await createRecurringTemplateAction(payload)
    } else if (kind === 'onboarding') {
      const payload = {
        title,
        description: description || null,
        isAdminPhase,
        defaultAssigneeRole: role,
        position: Number(position) || 0,
        isActive,
      }
      res = editTarget
        ? await updateOnboardingTemplateAction(editTarget.id, payload)
        : await createOnboardingTemplateAction(payload)
    } else {
      const payload = {
        title,
        description: description || null,
        defaultAssigneeRole: role,
        position: Number(position) || 0,
        isActive,
      }
      res = editTarget
        ? await updateOffboardingTemplateAction(editTarget.id, payload)
        : await createOffboardingTemplateAction(payload)
    }
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(editTarget ? 'Template updated' : 'Template created')
    setFormOpen(false)
    router.refresh()
  }

  async function remove(item: TaskTemplateItem) {
    setBusy(true)
    const res: { ok: boolean; error?: string } =
      kind === 'recurring'
        ? await deleteRecurringTemplateAction(item.id)
        : kind === 'onboarding'
          ? await deleteOnboardingTemplateAction(item.id)
          : await deleteOffboardingTemplateAction(item.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted "${item.title}"`)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNote flag={meta.flag} />}
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{meta.applicationNote}</p>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{items.length}</span> {meta.noun}s
        </p>
        {canEdit && (
          <Button type="button" size="sm" onClick={() => openForm(null)}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            New template
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No {meta.noun}s yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              data-testid={`${kind}-template-row`}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.title}
                  {kind === 'onboarding' && item.isAdminPhase && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Admin phase
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {kind === 'recurring' && item.scheduleType
                    ? `${item.scheduleType.replace('_', '-')}${item.dayOfMonth != null ? ` · day ${item.dayOfMonth}` : ''}`
                    : (item.description ?? '')}
                </p>
              </div>
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {roleLabel(item.defaultAssigneeRole)}
              </span>
              <span className="tnum w-10 shrink-0 text-right text-xs text-muted-foreground">
                #{item.position}
              </span>
              <span className="w-20 shrink-0">
                <ActiveState isActive={item.isActive} />
              </span>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${item.title}`}
                    onClick={() => openForm(item)}
                  >
                    <Pencil aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${item.title}`}
                    disabled={busy}
                    onClick={() => remove(item)}
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.title}` : `New ${meta.noun}`}</DialogTitle>
            <DialogDescription>{meta.applicationNote}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="tpl-title">Title</Label>
              <Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="tpl-description">Description</Label>
              <Textarea
                id="tpl-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {kind === 'recurring' && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Schedule</Label>
                  <Select value={scheduleType} onValueChange={setScheduleType}>
                    <SelectTrigger aria-label="Schedule type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.replace('_', '-')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28">
                  <Label htmlFor="tpl-dom">Day of month</Label>
                  <Input
                    id="tpl-dom"
                    inputMode="numeric"
                    className="tnum"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(e.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Label>Default assignee</Label>
                <RoleSelect value={role} onChange={setRole} />
              </div>
              <div className="w-28">
                <Label htmlFor="tpl-position">Position</Label>
                <Input
                  id="tpl-position"
                  inputMode="numeric"
                  className="tnum"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
              {kind === 'onboarding' && (
                <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
                  <Checkbox checked={isAdminPhase} onCheckedChange={(c) => setIsAdminPhase(c === true)} />
                  Admin phase
                </label>
              )}
              {editTarget && (
                <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
                  <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
                  Active
                </label>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={busy || title.trim() === ''}>
              {busy ? 'Saving...' : editTarget ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
