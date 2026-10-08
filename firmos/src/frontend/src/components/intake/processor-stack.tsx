'use client'

import { useState } from 'react'
import { ArrowRight, Check, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { IntakeMerchantAccountInput } from '@/server/intake'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import { normalizeInstitutionKey } from '@/shared/lib/institution-key'
import { cn } from '@/shared/lib/utils'

// The rename action loads lazily inside the handler - a static import would
// drag the db module into every client/test bundle that renders the wizard.

import { inputCls } from './account-screens'
import type { QuestionDef, WizardAnswers } from './registry'

/**
 * L2 (B3, 10_06 00:09:18-00:10:01): the processor card is ONE alphabetized
 * vertical stack - "clicking selects or highlights an item, editing
 * requires clicking a pencil icon to modify only the name, and new entries
 * can be added via an add processor button." The tile grid, the dropdown,
 * and the name field are gone (the K4 comparison is settled). A pick
 * commits the account row directly (C7: no name re-entry); a rename follows
 * committed rows on this intake by processor id.
 */
export function ProcessorStackScreen({
  q,
  answers,
  processors,
  onAddProcessor,
  onApply,
  onAdvance,
}: {
  q: QuestionDef
  answers: WizardAnswers
  processors: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
}) {
  const items = (q.get(answers) as IntakeMerchantAccountInput[] | undefined) ?? []
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fold = (s: string | null | undefined) => normalizeInstitutionKey(s) ?? ''
  const selectedIds = new Set(items.map((i) => i.processorId).filter((id): id is number => typeof id === 'number'))
  const selectedNames = new Set(items.map((i) => fold(i.processor ?? i.name)))
  const isSelected = (row: MerchantProcessorRow) => selectedIds.has(row.id) || selectedNames.has(fold(row.name))

  const commit = (next: IntakeMerchantAccountInput[]) => onApply(q.apply(answers, next))

  const toggle = (row: MerchantProcessorRow) => {
    setError(null)
    if (isSelected(row)) {
      commit(items.filter((i) => i.processorId !== row.id && fold(i.processor ?? i.name) !== fold(row.name)))
      return
    }
    // C7: the pick carries the name - no re-typing.
    commit([...items, { name: row.name, processor: row.name, processorId: row.id }])
  }

  const startRename = (row: MerchantProcessorRow) => {
    setEditingId(row.id)
    setEditName(row.name)
  }

  const saveRename = async (row: MerchantProcessorRow) => {
    const next = editName.trim()
    if (next === '' || next === row.name) {
      setEditingId(null)
      return
    }
    setBusy(true)
    const { renameMerchantProcessorAction } = await import('@/server/actions/merchant-processors')
    const res = await renameMerchantProcessorAction(row.id, next)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Renamed to "${res.data.name}".`)
    // Committed rows on this intake follow the new name by processor id.
    if (selectedIds.has(row.id)) {
      commit(
        items.map((i) =>
          i.processorId === row.id ? { ...i, name: res.data.name, processor: res.data.name } : i,
        ),
      )
    }
    setEditingId(null)
    // The parent wizard refetches lists on its own cadence; patch locally.
    row.name = res.data.name
  }

  const addProcessor = async () => {
    const name = addName.trim()
    if (name === '' || !onAddProcessor) return
    setBusy(true)
    const row = await onAddProcessor(name)
    setBusy(false)
    if (!row) {
      toast.error('Could not add the processor - try again.')
      return
    }
    setAddName('')
    setAddOpen(false)
    // The new processor arrives already selected (it is why it was added).
    if (!isSelected(row)) commit([...items, { name: row.name, processor: row.name, processorId: row.id }])
    processors.push(row)
    processors.sort((a, b) => a.name.localeCompare(b.name))
  }

  const finish = () => {
    if (q.required && items.length === 0) {
      setError('Pick at least one processor, or go back.')
      return
    }
    onAdvance()
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl border border-border bg-card" data-testid="processor-stack">
        {processors.map((row) => {
          const selected = isSelected(row)
          const editing = editingId === row.id
          return (
            <li key={row.id} className="flex items-center gap-2 px-3 py-1.5" data-testid={`processor-row-${row.name}`}>
              {editing ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    aria-label={`Rename ${row.name}`}
                    className={inputCls}
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(row)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <Button type="button" variant="action" size="sm" disabled={busy} onClick={() => void saveRename(row)} data-testid={`processor-rename-save-${row.id}`}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    data-testid={`processor-toggle-${row.name}`}
                    onClick={() => toggle(row)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        selected ? 'border-firm-brand bg-firm-brand text-white' : 'border-input bg-card',
                      )}
                      aria-hidden
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn('truncate text-sm', selected ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {row.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit the ${row.name} name`}
                    data-testid={`processor-edit-${row.name}`}
                    onClick={() => startRename(row)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {addOpen ? (
        <div className="flex items-center gap-2" data-testid="processor-add-form">
          <input
            aria-label="New processor name"
            className={inputCls}
            placeholder="Helcim"
            value={addName}
            autoFocus
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addProcessor()
              if (e.key === 'Escape') setAddOpen(false)
            }}
          />
          <Button type="button" variant="action" size="sm" disabled={busy || addName.trim() === ''} onClick={() => void addProcessor()} data-testid="processor-add-submit">
            Add processor
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="processor-add-open"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add processor
        </button>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <Button type="button" variant="action" onClick={finish} data-testid="continue">
        Continue
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
