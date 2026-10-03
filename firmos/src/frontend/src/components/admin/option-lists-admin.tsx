'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  addOptionValueAction,
  renameOptionValueAction,
  setOptionValueActiveAction,
} from '@/server/actions/option-lists'
import type { OptionValueRow } from '@/server/option-lists'
import { cn } from '@/shared/lib/utils'

/**
 * K3 (J16, "admin-configurable everything"): the option-lists manager. Every
 * reusable dropdown/chip list in the app - one screen per list with add
 * (staff-level, the same dedupe as the intake), rename + deactivate
 * (owner/admin). Deactivated values stop offering but never vanish, so
 * historical answers keep rendering.
 */

export interface OptionListAdminData {
  key: string
  label: string
  noun: string
  values: OptionValueRow[]
}

export function OptionListsAdmin({ lists, canManage }: { lists: OptionListAdminData[]; canManage: boolean }) {
  const router = useRouter()
  const [activeKey, setActiveKey] = useState(lists[0]?.key ?? '')
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [busy, setBusy] = useState(false)

  const active = lists.find((l) => l.key === activeKey) ?? lists[0]
  const values = active?.values ?? []

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return false
    }
    toast.success(success)
    router.refresh()
    return true
  }

  async function add() {
    const name = newName.trim()
    if (!name || !active) return
    const ok = await run(() => addOptionValueAction(active.key, name), `Added "${name}" to ${active.label}.`)
    if (ok) setNewName('')
  }

  async function rename(id: number) {
    const name = renameText.trim()
    if (!name || !active) return
    const ok = await run(() => renameOptionValueAction(active.key, id, name), 'Renamed.')
    if (ok) {
      setRenamingId(null)
      setRenameText('')
    }
  }

  if (!active) return null

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]" data-testid="option-lists-admin">
      {/* List picker */}
      <nav aria-label="Option lists" className="space-y-1">
        {lists.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => {
              setActiveKey(l.key)
              setRenamingId(null)
              setNewName('')
            }}
            data-testid={`list-tab-${l.key}`}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              l.key === active.key
                ? 'border-firm-brand bg-accent font-medium text-accent-foreground'
                : 'border-border bg-card text-foreground hover:border-firm-brand/60 hover:bg-accent/50',
            )}
          >
            {l.label}
            <span className="tnum text-xs text-muted-foreground">{l.values.length}</span>
          </button>
        ))}
      </nav>

      {/* Values */}
      <section className="rounded-xl border border-border bg-card" aria-label={active.label}>
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{active.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everything here is offered in future intakes - alphabetized, duplicate-safe.
          </p>
        </header>

        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              aria-label={`New ${active.noun}`}
              data-testid="option-add-input"
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              placeholder={`Add a ${active.noun}…`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={busy || newName.trim() === ''} data-testid="option-add-submit">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add
            </Button>
          </div>
        </div>

        <ul className="divide-y divide-border" data-testid="option-values">
          {values.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing on this list yet.</li>
          )}
          {values.map((v) => (
            <li
              key={v.id}
              data-testid={`option-value-${v.id}`}
              data-active={v.isActive}
              className={cn('flex items-center gap-2 px-4 py-2', !v.isActive && 'opacity-55')}
            >
              {renamingId === v.id ? (
                <>
                  <input
                    aria-label={`Rename ${v.name}`}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    value={renameText}
                    autoFocus
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void rename(v.id)
                      }
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                  <Button type="button" variant="ghost" size="sm" aria-label="Save the new name" onClick={() => void rename(v.id)} disabled={busy}>
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel renaming" onClick={() => setRenamingId(null)}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {v.name}
                    {!v.isActive && <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>}
                  </span>
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Rename ${v.name}`}
                        data-testid={`option-rename-${v.id}`}
                        onClick={() => {
                          setRenamingId(v.id)
                          setRenameText(v.name)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={v.isActive ? `Hide ${v.name}` : `Show ${v.name}`}
                        data-testid={`option-toggle-${v.id}`}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => setOptionValueActiveAction(active.key, v.id, !v.isActive),
                            v.isActive ? `"${v.name}" is hidden from future picks.` : `"${v.name}" is back on the list.`,
                          )
                        }
                      >
                        {v.isActive ? <X className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
