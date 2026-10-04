'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { addClientNoteAction, editClientNoteAction, type ClientNoteItem } from '@/server/actions/client-notes'
import { stampLabel } from '@/shared/lib/date-display'

/**
 * K7 (V18/C9): the client record's notes panel - every note readable and
 * editable in place (the intake's internal + running notes land here at
 * conversion). Prominent by design: the old system buried them.
 */
export function ClientNotesPanel({ clientId, notes }: { clientId: number; notes: ClientNoteItem[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Something went wrong - try again.')
      return
    }
    toast.success(success)
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="client-notes-panel">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Everything the team knows about this client - intake notes land here at conversion.
        </p>
      </header>

      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <textarea
            aria-label="Add a note"
            data-testid="client-note-input"
            className="min-h-16 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            placeholder="Wants the close by the 10th. Texts, never emails…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            type="button"
            variant="action"
            size="sm"
            disabled={busy || draft.trim() === ''}
            data-testid="client-note-add"
            onClick={async () => {
              await run(() => addClientNoteAction(clientId, draft), 'Note added.')
              setDraft('')
            }}
          >
            Add note
          </Button>
        </div>
      </div>

      <ul className="divide-y divide-border" data-testid="client-notes-list">
        {notes.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="client-notes-empty">
            No notes yet.
          </li>
        )}
        {notes.map((n) => (
          <li key={n.id} className="px-4 py-2.5" data-testid={`client-note-${n.id}`}>
            {editingId === n.id ? (
              <div className="flex items-start gap-2">
                <textarea
                  aria-label="Edit the note"
                  className="min-h-16 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Save the note"
                  disabled={busy}
                  onClick={async () => {
                    await run(() => editClientNoteAction(n.id, editText), 'Note saved.')
                    setEditingId(null)
                  }}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Cancel" onClick={() => setEditingId(null)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ) : (
              <div className="group flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                  <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                    {n.authorName ?? 'The team'} · {stampLabel(n.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Edit the note"
                  data-testid={`client-note-edit-${n.id}`}
                  onClick={() => {
                    setEditingId(n.id)
                    setEditText(n.body)
                  }}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
