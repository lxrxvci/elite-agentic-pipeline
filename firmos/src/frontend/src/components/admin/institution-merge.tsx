'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { applyInstitutionChangeAction, previewInstitutionChangeAction } from '@/server/actions/institution-merge'
import type { InstitutionMergePreview, SopRetentionChoices } from '@/server/institution-merge'
import type { InstitutionRow } from '@/server/institutions'

export function InstitutionMergeAdmin({ initialRows }: { initialRows: InstitutionRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [editing, setEditing] = useState<InstitutionRow | null>(null)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<InstitutionMergePreview | null>(null)
  const [retention, setRetention] = useState<SopRetentionChoices>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const open = (row: InstitutionRow) => {
    setEditing(row)
    setName(row.name)
    setPreview(null)
    setRetention({})
    setError(null)
  }
  const loadPreview = async () => {
    if (!editing || !name.trim()) return
    setBusy(true)
    setError(null)
    const result = await previewInstitutionChangeAction(editing.id, name)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setPreview(result.data)
    setRetention({})
  }
  const apply = async () => {
    if (!editing || !preview) return
    setBusy(true)
    setError(null)
    const result = await applyInstitutionChangeAction(editing.id, name, preview.mode === 'merge', retention)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    const data = result.data
    setRows((current) => data.mode === 'merge'
      ? current.filter((row) => row.id !== editing.id)
      : current.map((row) => row.id === editing.id ? { ...row, name: data.requestedName } : row).sort((a, b) => a.name.localeCompare(b.name)))
    setMessage(data.mode === 'merge' ? `${data.source.name} merged into ${data.target?.name}.` : `Institution renamed to ${data.requestedName}.`)
    setEditing(null)
    setPreview(null)
    router.refresh()
  }
  const unresolved = preview?.overlaps.some((overlap) => retention[overlap.key] == null) ?? false

  return (
    <section aria-labelledby="institution-admin-title" className="w-full min-w-0">
      <h2 id="institution-admin-title" className="text-base font-semibold">Institutions</h2>
      <p className="mt-1 text-sm text-muted-foreground">Rename an institution or merge a duplicate after reviewing its clients, accounts, and procedures.</p>
      {message && <p role="status" className="mt-3 text-sm text-foreground">{message}</p>}
      <div className="mt-4 w-full min-w-0 overflow-x-auto rounded-lg border border-border">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Name</th><th className="w-20 px-2 py-2 text-right font-medium sm:w-40"><span className="hidden sm:inline">Action</span><span className="sr-only sm:hidden">Review</span></th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="break-words px-4 py-2.5">{row.name}</td><td className="px-2 py-2.5 text-right sm:px-4"><Button variant="outline" size="sm" aria-label={`Rename or merge ${row.name}`} onClick={() => open(row)}>Review</Button></td></tr>)}
          </tbody>
        </table>
      </div>
      <Dialog open={editing != null} onOpenChange={(openState) => { if (!busy) { setEditing(openState ? editing : null); setPreview(null); setError(null) } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="institution-merge-dialog">
          <DialogHeader>
            <DialogTitle>Rename or merge {editing?.name}</DialogTitle>
            <DialogDescription>Enter an existing institution’s name to merge into it. Nothing changes until you review and confirm.</DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium" htmlFor="institution-name">Institution name</label>
          <input id="institution-name" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setPreview(null); setRetention({}) }} />
          <Button type="button" variant="outline" onClick={() => void loadPreview()} disabled={busy || !name.trim()}>Review affected records</Button>
          {preview && (
            <div data-testid="institution-merge-preview" className="space-y-4">
              <p className="text-sm">{preview.mode === 'merge' ? `Merge ${preview.source.name} into ${preview.target?.name}.` : `Rename ${preview.source.name} to ${preview.requestedName}.`}</p>
              <p className="text-sm text-muted-foreground"><span className="tnum">{preview.clientCount}</span> clients · <span className="tnum">{preview.accountCount}</span> accounts · <span className="tnum">{preview.sops.length}</span> active SOPs</p>
              {preview.sops.length > 0 && <ul className="text-sm">{preview.sops.map((sop) => <li key={sop.id}>{sop.title} <span className="text-muted-foreground">({sop.side === 'source' ? preview.source.name : preview.target?.name})</span></li>)}</ul>}
              {preview.overlaps.map((overlap) => (
                <fieldset key={overlap.key} className="space-y-2">
                  <legend className="text-sm font-medium">Which SOP should remain active?</legend>
                  <p className="text-sm text-muted-foreground">Both institutions have a procedure. The other remains in inactive history.</p>
                  <label className="flex items-start gap-2 text-sm"><input type="radio" name={`retain-${overlap.key}`} checked={retention[overlap.key] === 'source'} onChange={() => setRetention((current) => ({ ...current, [overlap.key]: 'source' }))} />{overlap.sourceTitle} <span className="text-muted-foreground">from {preview.source.name}</span></label>
                  <label className="flex items-start gap-2 text-sm"><input type="radio" name={`retain-${overlap.key}`} checked={retention[overlap.key] === 'target'} onChange={() => setRetention((current) => ({ ...current, [overlap.key]: 'target' }))} />{overlap.targetTitle} <span className="text-muted-foreground">from {preview.target?.name}</span></label>
                </fieldset>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-status-overdue">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            {preview && <Button type="button" onClick={() => void apply()} disabled={busy || unresolved}>{preview.mode === 'merge' ? 'Merge institutions' : 'Rename institution'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
