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
  addProjectTemplateTaskAction,
  createProjectTemplateAction,
  deleteProjectTemplateAction,
  deleteProjectTemplateTaskAction,
  updateProjectTemplateAction,
} from '@/server/actions/templates'

import { ActiveState, ReadOnlyNote, RoleSelect, roleLabel } from './shared'

/**
 * Project template admin (§19 system 6). Each template carries an ordered
 * task list with a prerequisite chain - a task's prerequisite must be another
 * task in the SAME template, and the chain is remapped to real project task
 * ids when a project is created from the template.
 */

export interface ProjectTemplateTaskItem {
  id: number
  title: string
  description: string | null
  taskKind: string
  prerequisiteId: number | null
  defaultAssigneeRole: string | null
  position: number
}

export interface ProjectTemplateItem {
  id: number
  name: string
  description: string | null
  isActive: boolean
  tasks: ProjectTemplateTaskItem[]
}

interface ProjectTemplateAdminProps {
  templates: ProjectTemplateItem[]
  /** can_edit_task_templates or owner/admin (decided server-side). */
  canEdit: boolean
}

export function ProjectTemplateAdmin({ templates, canEdit }: ProjectTemplateAdminProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<ProjectTemplateItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [taskParent, setTaskParent] = useState<ProjectTemplateItem | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskKind, setTaskKind] = useState<string>('one_off')
  const [taskPrereqId, setTaskPrereqId] = useState<number | null>(null)
  const [taskRole, setTaskRole] = useState<string | null>(null)

  function openTemplateForm(target: ProjectTemplateItem | null) {
    setEditTarget(target)
    setName(target?.name ?? '')
    setDescription(target?.description ?? '')
    setIsActive(target?.isActive ?? true)
    setFormOpen(true)
  }

  function openTaskForm(parent: ProjectTemplateItem) {
    setTaskParent(parent)
    setTaskTitle('')
    setTaskDescription('')
    setTaskKind('one_off')
    setTaskPrereqId(null)
    setTaskRole(null)
  }

  async function saveTemplate() {
    setBusy(true)
    const res: { ok: boolean; error?: string } = editTarget
      ? await updateProjectTemplateAction(editTarget.id, { name, description: description || null, isActive })
      : await createProjectTemplateAction({ name, description: description || null })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(editTarget ? 'Template updated' : 'Template created')
    setFormOpen(false)
    router.refresh()
  }

  async function saveTask() {
    if (!taskParent) return
    setBusy(true)
    const res: { ok: boolean; error?: string } = await addProjectTemplateTaskAction(taskParent.id, {
      title: taskTitle,
      description: taskDescription || null,
      taskKind: taskKind as 'one_off' | 'time_period',
      prerequisiteId: taskPrereqId,
      defaultAssigneeRole: taskRole,
      position: taskParent.tasks.length,
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Task added to the template')
    setTaskParent(null)
    router.refresh()
  }

  async function removeTask(task: ProjectTemplateTaskItem) {
    setBusy(true)
    const res: { ok: boolean; error?: string } = await deleteProjectTemplateTaskAction(task.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Removed "${task.title}"`)
    router.refresh()
  }

  async function removeTemplate(tpl: ProjectTemplateItem) {
    setBusy(true)
    const res: { ok: boolean; error?: string } = await deleteProjectTemplateAction(tpl.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted "${tpl.name}"`)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNote flag="can_edit_task_templates" />}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{templates.length}</span> project templates
        </p>
        {canEdit && (
          <Button type="button" size="sm" onClick={() => openTemplateForm(null)}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            New template
          </Button>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No project templates yet.
        </div>
      ) : (
        templates.map((tpl) => {
          const titleById = new Map(tpl.tasks.map((t) => [t.id, t.title] as const))
          return (
            <section
              key={tpl.id}
              data-testid="project-template-card"
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{tpl.name}</p>
                  {tpl.description && (
                    <p className="truncate text-xs text-muted-foreground">{tpl.description}</p>
                  )}
                </div>
                <ActiveState isActive={tpl.isActive} />
                <span className="tnum text-xs text-muted-foreground">
                  {tpl.tasks.length} task{tpl.tasks.length === 1 ? '' : 's'}
                </span>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => openTaskForm(tpl)}>
                      <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                      Add task
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${tpl.name}`}
                      onClick={() => openTemplateForm(tpl)}
                    >
                      <Pencil aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${tpl.name}`}
                      disabled={busy}
                      onClick={() => removeTemplate(tpl)}
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </header>
              {tpl.tasks.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">No tasks in this template yet.</p>
              ) : (
                tpl.tasks.map((task) => (
                  <div
                    key={task.id}
                    data-testid="project-template-task"
                    className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                      {task.prerequisiteId != null && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          After: {titleById.get(task.prerequisiteId) ?? `#${task.prerequisiteId}`}
                        </p>
                      )}
                    </div>
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      {task.taskKind === 'time_period' ? 'Per period' : 'One-off'}
                    </span>
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {roleLabel(task.defaultAssigneeRole)}
                    </span>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${task.title}`}
                        disabled={busy}
                        onClick={() => removeTask(task)}
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </section>
          )
        })
      )}

      {/* Create / edit template */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.name}` : 'New project template'}</DialogTitle>
            <DialogDescription>
              Chosen at project creation; spawns its task list with prerequisite chains intact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ptpl-name">Name</Label>
              <Input id="ptpl-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ptpl-description">Description</Label>
              <Textarea
                id="ptpl-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {editTarget && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
                Active
              </label>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveTemplate} disabled={busy || name.trim() === ''}>
              {busy ? 'Saving...' : editTarget ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add task */}
      <Dialog open={taskParent != null} onOpenChange={(open) => !open && setTaskParent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add task to &quot;{taskParent?.name}&quot;</DialogTitle>
            <DialogDescription>
              A prerequisite must be another task in this template - the chain is preserved when the
              template spawns a real project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ptask-title">Title</Label>
              <Input id="ptask-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ptask-description">Description</Label>
              <Textarea
                id="ptask-description"
                rows={2}
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label>Kind</Label>
                <Select value={taskKind} onValueChange={setTaskKind}>
                  <SelectTrigger aria-label="Task kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_off">One-off</SelectItem>
                    <SelectItem value="time_period">Per period</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44">
                <Label>Default assignee</Label>
                <RoleSelect value={taskRole} onChange={setTaskRole} />
              </div>
              <div className="w-48">
                <Label>Prerequisite</Label>
                <Select
                  value={taskPrereqId != null ? String(taskPrereqId) : 'none'}
                  onValueChange={(v) => setTaskPrereqId(v === 'none' ? null : Number(v))}
                >
                  <SelectTrigger aria-label="Prerequisite task">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {taskParent?.tasks.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setTaskParent(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveTask} disabled={busy || taskTitle.trim() === ''}>
              Add task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
