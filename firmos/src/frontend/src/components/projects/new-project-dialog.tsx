'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createProjectAction,
  suggestCatchUpRangesAction,
} from '@/server/actions/projects'
import { CATCH_UP_NAME_PATTERN } from '@/shared/lib/catch-up'
import type { CatchUpRange } from '@/server/projects'
import type { ProjectTemplateRow } from '@/server/templates'

/**
 * New-project dialog (HANDOFF §20): client, name, optional template (spawns
 * the checklist with prerequisite chains), billing mode, and the catch-up
 * generator. The catch-up option appears only when the name suggests
 * catch-up bookkeeping; selecting it previews the detected yearly ranges.
 */

interface NewProjectDialogProps {
  clients: { id: number; name: string }[]
  templates: Pick<ProjectTemplateRow, 'id' | 'name'>[]
  /** Preselected client when opened from a client surface. */
  defaultClientId?: number
  triggerLabel?: string
}

export function NewProjectDialog({ clients, templates, defaultClientId, triggerLabel = 'New project' }: NewProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState<string>(defaultClientId != null ? String(defaultClientId) : '')
  const [templateId, setTemplateId] = useState<string>('none')
  const [name, setName] = useState('')
  const [billingMode, setBillingMode] = useState<'project' | 'tasks'>('project')
  const [detectCatchUp, setDetectCatchUp] = useState(false)
  const [ranges, setRanges] = useState<CatchUpRange[]>([])
  const [submitting, setSubmitting] = useState(false)

  const nameSuggestsCatchUp = useMemo(() => CATCH_UP_NAME_PATTERN.test(name), [name])

  // Detection preview (§20): once the name suggests catch-up and the user
  // opts in, show the yearly ranges the engine would generate against.
  useEffect(() => {
    if (!nameSuggestsCatchUp || !detectCatchUp || clientId === '') {
      setRanges([])
      return
    }
    let cancelled = false
    void suggestCatchUpRangesAction(Number(clientId)).then((res) => {
      if (!cancelled && res.ok) setRanges(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [nameSuggestsCatchUp, detectCatchUp, clientId])

  function reset() {
    setClientId(defaultClientId != null ? String(defaultClientId) : '')
    setTemplateId('none')
    setName('')
    setBillingMode('project')
    setDetectCatchUp(false)
    setRanges([])
  }

  async function submit() {
    if (clientId === '' || name.trim() === '') return
    setSubmitting(true)
    const res = await createProjectAction(Number(clientId), {
      name: name.trim(),
      billingMode,
      templateId: templateId === 'none' ? null : Number(templateId),
      detectCatchUp: detectCatchUp && nameSuggestsCatchUp,
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setOpen(false)
    reset()
    toast.success(
      res.data.catchUpTasksGenerated > 0
        ? `Project created - ${res.data.catchUpTasksGenerated} catch-up tasks generated`
        : 'Project created',
    )
    router.push(`/projects/${res.data.project.id}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="h-8" data-testid="new-project-button">
          <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Retroactive catch-up work or a one-off engagement. Pick a template to spawn its
            checklist with prerequisite chains, or start empty.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="project-client" aria-label="Client">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2025 books catch-up"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-template">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="project-template" aria-label="Template">
                  <SelectValue placeholder="No template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-billing">Billing</Label>
              <Select value={billingMode} onValueChange={(v) => setBillingMode(v as 'project' | 'tasks')}>
                <SelectTrigger id="project-billing" aria-label="Billing mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Fixed price</SelectItem>
                  <SelectItem value="tasks">Per task</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {nameSuggestsCatchUp && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <label className="flex items-start gap-2.5">
                <Checkbox
                  checked={detectCatchUp}
                  onCheckedChange={(checked) => setDetectCatchUp(checked === true)}
                  aria-label="Generate catch-up tasks"
                  className="mt-0.5"
                />
                <span className="text-xs text-foreground">
                  <span className="font-semibold">Generate catch-up tasks</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    One monthly-grid task per active account per detected year.
                    {detectCatchUp && ranges.length > 0 && (
                      <span className="tnum mt-0.5 block" data-testid="catchup-range-preview">
                        Detected: {ranges.map((r) => (r.toMonth === 12 ? `${r.year}` : `${r.year} (through month ${r.toMonth})`)).join(', ')}
                      </span>
                    )}
                    {detectCatchUp && clientId !== '' && ranges.length === 0 && (
                      <span className="mt-0.5 block" data-testid="catchup-range-preview">
                        No catch-up range detected for this client.
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={submitting || clientId === '' || name.trim() === ''}
            data-testid="create-project-submit"
          >
            {submitting ? 'Creating...' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
