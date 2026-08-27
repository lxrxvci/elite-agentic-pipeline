'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
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
  createAdHocTemplateAction,
  deleteAdHocTemplateAction,
  mintAdHocTaskAction,
  updateAdHocTemplateAction,
} from '@/server/actions/templates'

import { ActiveState, ClientSelect, ReadOnlyNote, RoleSelect, roleLabel, type ClientRef } from './shared'

/**
 * Ad-hoc task template admin (§19 system 2). "Create task" mints ONE task
 * from a template onto a chosen client - status new, assignee and due date
 * derived by the engine. Minting is staff-level, so it stays visible without
 * the edit flag; template CRUD needs can_edit_task_templates.
 */

export interface AdHocTemplateItem {
  id: number
  title: string
  description: string | null
  defaultAssigneeRole: string | null
  dueInDays: number
  isActive: boolean
}

interface AdHocAdminProps {
  templates: AdHocTemplateItem[]
  clients: ClientRef[]
  /** can_edit_task_templates or owner/admin (decided server-side). */
  canEdit: boolean
}

export function AdHocAdmin({ templates, clients, canEdit }: AdHocAdminProps) {
  const router = useRouter()
  const [editTarget, setEditTarget] = useState<AdHocTemplateItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [mintTarget, setMintTarget] = useState<AdHocTemplateItem | null>(null)
  const [mintClientId, setMintClientId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [dueInDays, setDueInDays] = useState('7')
  const [isActive, setIsActive] = useState(true)

  function openForm(target: AdHocTemplateItem | null) {
    setEditTarget(target)
    setTitle(target?.title ?? '')
    setDescription(target?.description ?? '')
    setRole(target?.defaultAssigneeRole ?? null)
    setDueInDays(String(target?.dueInDays ?? 7))
    setIsActive(target?.isActive ?? true)
    setFormOpen(true)
  }

  async function save() {
    setBusy(true)
    const payload = {
      title,
      description: description || null,
      defaultAssigneeRole: role,
      dueInDays: Number(dueInDays) || 7,
      isActive,
    }
    const res: { ok: boolean; error?: string } = editTarget
      ? await updateAdHocTemplateAction(editTarget.id, payload)
      : await createAdHocTemplateAction(payload)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(editTarget ? 'Template updated' : 'Template created')
    setFormOpen(false)
    router.refresh()
  }

  async function mint() {
    if (!mintTarget || mintClientId == null) return
    setBusy(true)
    const res: { ok: boolean; error?: string } = await mintAdHocTaskAction(mintTarget.id, mintClientId)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Task "${mintTarget.title}" created on the client`)
    setMintTarget(null)
    setMintClientId(null)
  }

  async function remove(item: AdHocTemplateItem) {
    setBusy(true)
    const res: { ok: boolean; error?: string } = await deleteAdHocTemplateAction(item.id)
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
      {!canEdit && <ReadOnlyNote flag="can_edit_task_templates" />}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{templates.length}</span> ad-hoc templates
        </p>
        {canEdit && (
          <Button type="button" size="sm" onClick={() => openForm(null)}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            New template
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {templates.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No ad-hoc templates yet.</p>
        ) : (
          templates.map((tpl) => (
            <div
              key={tpl.id}
              data-testid="adhoc-template-row"
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{tpl.title}</p>
                {tpl.description && (
                  <p className="truncate text-xs text-muted-foreground">{tpl.description}</p>
                )}
              </div>
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {roleLabel(tpl.defaultAssigneeRole)}
              </span>
              <span className="tnum w-20 shrink-0 text-right text-xs text-muted-foreground">
                {tpl.dueInDays}d lead
              </span>
              <span className="w-20 shrink-0">
                <ActiveState isActive={tpl.isActive} />
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!tpl.isActive || busy}
                  data-testid={`mint-${tpl.id}`}
                  onClick={() => {
                    setMintTarget(tpl)
                    setMintClientId(null)
                  }}
                >
                  <Sparkles aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                  Create task
                </Button>
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${tpl.title}`}
                      onClick={() => openForm(tpl)}
                    >
                      <Pencil aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${tpl.title}`}
                      disabled={busy}
                      onClick={() => remove(tpl)}
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.title}` : 'New ad-hoc template'}</DialogTitle>
            <DialogDescription>
              One-shot task definition. Minting copies linked SOPs and derives the assignee and due
              date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="adhoc-title">Title</Label>
              <Input id="adhoc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="adhoc-description">Description</Label>
              <Textarea
                id="adhoc-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Label>Default assignee</Label>
                <RoleSelect value={role} onChange={setRole} />
              </div>
              <div className="w-28">
                <Label htmlFor="adhoc-due">Due in days</Label>
                <Input
                  id="adhoc-due"
                  inputMode="numeric"
                  className="tnum"
                  value={dueInDays}
                  onChange={(e) => setDueInDays(e.target.value)}
                />
              </div>
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

      {/* Mint a task */}
      <Dialog open={mintTarget != null} onOpenChange={(open) => !open && setMintTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create task from &quot;{mintTarget?.title}&quot;</DialogTitle>
            <DialogDescription>
              Mints one task on the chosen client with status New, due{' '}
              <span className="tnum">{mintTarget?.dueInDays ?? 7}</span> days out. The assignee
              comes from the template default, mapped to the client&apos;s staff.
            </DialogDescription>
          </DialogHeader>
          <ClientSelect clients={clients} value={mintClientId} onChange={setMintClientId} />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setMintTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={mint} disabled={busy || mintClientId == null}>
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
