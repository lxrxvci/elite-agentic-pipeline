'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  addCustomChecklistItemAction,
  setChecklistItemCompleteAction,
} from '@/server/actions/tax'
import { cn } from '@/shared/lib/utils'

import { YearNav } from './year-nav'

/**
 * Client Year-End Tax tab (§18): the per-client checklist for one year.
 * Checklist rows have no due-date column and no staff notes editor in the
 * engine - rows render title, assignee, a pending/done toggle, and any
 * CPA-provided notes read-only. Managers add custom items (template_id null).
 */

export interface TaxChecklistItem {
  id: number
  title: string
  isCompleted: boolean
  /** null template id = manager-added custom item. */
  isCustom: boolean
  assigneeName: string | null
  notes: string | null
  cpaNotes: string | null
}

export function checklistCounts(items: Pick<TaxChecklistItem, 'isCompleted'>[]): {
  done: number
  total: number
} {
  return { done: items.filter((i) => i.isCompleted).length, total: items.length }
}

interface ClientTaxPanelProps {
  clientId: number
  year: number
  items: TaxChecklistItem[]
  /** manager+ - shows the custom-item form. */
  canManage: boolean
}

export function ClientTaxPanel({ clientId, year, items, canManage }: ClientTaxPanelProps) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [customTitle, setCustomTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const { done, total } = checklistCounts(items)

  async function toggle(item: TaxChecklistItem, complete: boolean) {
    setPendingId(item.id)
    const res: { ok: boolean; error?: string } = await setChecklistItemCompleteAction(item.id, complete)
    setPendingId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    router.refresh()
  }

  async function addCustom() {
    const title = customTitle.trim()
    if (title === '') return
    setAdding(true)
    const res: { ok: boolean; error?: string } = await addCustomChecklistItemAction(clientId, year, title)
    setAdding(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setCustomTitle('')
    toast.success('Custom item added')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground" data-testid="tax-completion-count">
          <span className="tnum font-semibold text-foreground">{done}</span> of{' '}
          <span className="tnum">{total}</span> complete for {year}
        </p>
        <YearNav year={year} />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <ClipboardList className="h-5 w-5 text-accent-foreground" aria-hidden />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-foreground">No checklist for {year}</h3>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            The year-end checklist populates from the firm templates the first time a year is
            opened.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {items.map((item) => (
            <div key={item.id} data-testid="tax-checklist-row" className="border-b border-border last:border-b-0">
              <div className="flex min-h-12 items-center gap-3 px-4 py-2">
                <Checkbox
                  checked={item.isCompleted}
                  disabled={pendingId === item.id}
                  onCheckedChange={(checked) => toggle(item, checked === true)}
                  aria-label={`Mark "${item.title}" ${item.isCompleted ? 'pending' : 'done'}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      item.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
                    )}
                  >
                    {item.title}
                  </p>
                  {item.isCustom && (
                    <p className="text-[11px] font-medium text-muted-foreground">Custom item</p>
                  )}
                  {item.notes && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.assigneeName ?? 'Unassigned'}
                </span>
                <span
                  className={cn(
                    'tnum w-16 shrink-0 text-right text-[11px] font-semibold',
                    item.isCompleted ? 'text-status-on-track' : 'text-muted-foreground',
                  )}
                >
                  {item.isCompleted ? 'Done' : 'Pending'}
                </span>
              </div>
              {item.cpaNotes && (
                <div className="border-t border-dashed border-border bg-muted/40 px-4 py-2 pl-11">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    CPA notes
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                    {item.cpaNotes}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addCustom()
          }}
        >
          <Input
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={`Add a custom ${year} item...`}
            aria-label="Custom checklist item title"
            className="h-8 max-w-sm text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={adding || customTitle.trim() === ''}>
            <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Add item
          </Button>
        </form>
      )}
    </div>
  )
}
