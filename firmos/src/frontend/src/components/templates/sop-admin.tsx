'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Send, Trash2 } from 'lucide-react'
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
  applySopToClientAction,
  createSopTemplateAction,
  deleteSopTemplateAction,
  updateSopTemplateAction,
} from '@/server/actions/templates'
import { stampLabel } from '@/shared/lib/date-display'

import { ActiveState, ClientSelect, ReadOnlyNote, type ClientRef } from './shared'

/**
 * SOP template admin (§19 system 1). Edits to an SOP PROPAGATE to every
 * linked client manual entry (mirror semantics) - the edit dialog says so
 * before saving. Applying to a client creates the mirrored manual entry and
 * is staff-level, so it stays visible without the edit flag.
 *
 * Institution key (owner call notes): an SOP keyed to an institution (e.g.
 * "Chevron WEX") auto-links to any client whose accounts carry that
 * institution at conversion. Every row shows the staleness failsafe:
 * "Updated {date}" plus the change note when present.
 */

export interface SopTemplateItem {
  id: number
  title: string
  content: string | null
  position: number
  isActive: boolean
  institutionKey: string | null
  changeNote: string | null
  updatedAt: string
}

interface SopAdminProps {
  sops: SopTemplateItem[]
  clients: ClientRef[]
  /** can_edit_sops or owner/admin (decided server-side). */
  canEdit: boolean
}

export function SopAdmin({ sops, clients, canEdit }: SopAdminProps) {
  const router = useRouter()
  const [editTarget, setEditTarget] = useState<SopTemplateItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [applyTarget, setApplyTarget] = useState<SopTemplateItem | null>(null)
  const [applyClientId, setApplyClientId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [position, setPosition] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [institutionKey, setInstitutionKey] = useState('')
  const [changeNote, setChangeNote] = useState('')

  function openForm(target: SopTemplateItem | null) {
    setEditTarget(target)
    setTitle(target?.title ?? '')
    setContent(target?.content ?? '')
    setPosition(String(target?.position ?? 0))
    setIsActive(target?.isActive ?? true)
    setInstitutionKey(target?.institutionKey ?? '')
    setChangeNote(target?.changeNote ?? '')
    setFormOpen(true)
  }

  async function save() {
    setBusy(true)
    // The action's success arm widens ok to boolean; type the union locally.
    const res: { ok: boolean; error?: string } = editTarget
      ? await updateSopTemplateAction(editTarget.id, {
          title,
          content: content || null,
          position: Number(position) || 0,
          isActive,
          institutionKey: institutionKey || null,
          changeNote: changeNote || null,
        })
      : await createSopTemplateAction({
          title,
          content: content || null,
          position: Number(position) || 0,
          institutionKey: institutionKey || null,
          changeNote: changeNote || null,
        })
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(editTarget ? 'SOP updated - linked client manuals picked up the change' : 'SOP created')
    setFormOpen(false)
    router.refresh()
  }

  async function apply() {
    if (!applyTarget || applyClientId == null) return
    setBusy(true)
    const res: { ok: boolean; error?: string } = await applySopToClientAction(applyTarget.id, applyClientId)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Applied "${applyTarget.title}" to the client's manual`)
    setApplyTarget(null)
    setApplyClientId(null)
  }

  async function remove(sop: SopTemplateItem) {
    setBusy(true)
    const res = await deleteSopTemplateAction(sop.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted "${sop.title}" - client manual entries were kept and unlinked`)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNote flag="can_edit_sops" />}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{sops.length}</span> SOP templates
        </p>
        {canEdit && (
          <Button type="button" size="sm" onClick={() => openForm(null)}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            New SOP
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {sops.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No SOP templates yet.</p>
        ) : (
          sops.map((sop) => (
            <div
              key={sop.id}
              data-testid="sop-row"
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{sop.title}</p>
                  {sop.institutionKey && (
                    <span
                      data-testid="sop-institution-chip"
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {sop.institutionKey}
                    </span>
                  )}
                </div>
                {sop.content && (
                  <p className="truncate text-xs text-muted-foreground">{sop.content}</p>
                )}
                <p className="tnum mt-0.5 text-[11px] text-muted-foreground" data-testid="sop-updated">
                  Updated {stampLabel(sop.updatedAt)}
                  {sop.changeNote ? ` - ${sop.changeNote}` : ''}
                </p>
              </div>
              <span className="tnum w-10 shrink-0 text-right text-xs text-muted-foreground">
                #{sop.position}
              </span>
              <span className="w-20 shrink-0">
                <ActiveState isActive={sop.isActive} />
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!sop.isActive || busy}
                  onClick={() => {
                    setApplyTarget(sop)
                    setApplyClientId(null)
                  }}
                >
                  <Send aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                  Apply to client
                </Button>
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${sop.title}`}
                      onClick={() => openForm(sop)}
                    >
                      <Pencil aria-hidden className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${sop.title}`}
                      disabled={busy}
                      onClick={() => remove(sop)}
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
            <DialogTitle>{editTarget ? `Edit ${editTarget.title}` : 'New SOP'}</DialogTitle>
            <DialogDescription>
              Saving an edit updates every client manual entry linked to this SOP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sop-title">Title</Label>
              <Input id="sop-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sop-content">Content</Label>
              <Textarea id="sop-content" rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                One step per line. Paste a Loom link on its own line to attach the walkthrough video.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sop-institution-key">Institution key</Label>
                <Input
                  id="sop-institution-key"
                  value={institutionKey}
                  onChange={(e) => setInstitutionKey(e.target.value)}
                  placeholder="e.g. Chevron WEX"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Auto-links this SOP to clients with an account at this institution.
                </p>
              </div>
              <div>
                <Label htmlFor="sop-change-note">Change note</Label>
                <Input
                  id="sop-change-note"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="What changed on this edit"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Shown next to the updated date everywhere this SOP appears.
                </p>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="w-28">
                <Label htmlFor="sop-position">Position</Label>
                <Input
                  id="sop-position"
                  inputMode="numeric"
                  className="tnum"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
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
              {busy ? 'Saving...' : editTarget ? 'Save changes' : 'Create SOP'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply to client */}
      <Dialog open={applyTarget != null} onOpenChange={(open) => !open && setApplyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply SOP to a client</DialogTitle>
            <DialogDescription>
              Adds &quot;{applyTarget?.title}&quot; to the client&apos;s manual as a mirrored entry.
              Future edits to the SOP update the client&apos;s copy automatically.
            </DialogDescription>
          </DialogHeader>
          <ClientSelect clients={clients} value={applyClientId} onChange={setApplyClientId} />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setApplyTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={apply} disabled={busy || applyClientId == null}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
