'use client'

import * as React from 'react'
import { StickyNote, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PickerCombobox } from '@/components/quick-add/picker-combobox'
import { relativeTime } from '@/components/notifications/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { addQuickNoteAction, deleteQuickNoteAction } from '@/server/actions/quick-add'
import type { QuickNoteFeedItem } from '@/server/quick-add'

/**
 * The /notes feed: a "New note" composer on top (same minimal shape as the
 * quick-add dialog) and the feed below. Adds prepend optimistically from the
 * action response; deletes are optimistic with a toast on failure. The
 * delete control only renders on the caller's own notes.
 */
export function NotesFeed({
  initialNotes,
  clients,
  currentUserId,
  currentUserName,
}: {
  initialNotes: QuickNoteFeedItem[]
  clients: { id: number; name: string }[]
  currentUserId: number
  currentUserName: string
}) {
  const [notes, setNotes] = React.useState<QuickNoteFeedItem[]>(initialNotes)
  const [body, setBody] = React.useState('')
  const [clientId, setClientId] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function addNote() {
    setBusy(true)
    try {
      const res = await addQuickNoteAction({ clientId, body })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const clientName = clients.find((c) => c.id === clientId)?.name ?? null
      setNotes((prev) => [
        {
          id: res.data.id,
          body: res.data.body,
          clientId: res.data.clientId,
          clientName,
          authorId: currentUserId,
          authorName: currentUserName,
          createdAt: res.data.createdAt,
        },
        ...prev,
      ])
      setBody('')
      setClientId(null)
      toast.success('Note added')
    } finally {
      setBusy(false)
    }
  }

  async function deleteNote(noteId: number) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    const res = await deleteQuickNoteAction(noteId)
    if (!res.ok) toast.error(res.error)
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Textarea
          aria-label="New note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a quick note…"
          rows={3}
          className="text-sm"
        />
        <div className="flex items-center gap-3">
          <div className="w-64">
            <PickerCombobox
              id="notes-feed-client"
              label="Client"
              options={clients.map((c) => ({ id: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Pick a client"
              noneLabel="Firm-wide"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="ml-auto h-8"
            disabled={busy || body.trim() === ''}
            onClick={() => void addNote()}
          >
            {busy ? 'Adding…' : 'Add note'}
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <StickyNote aria-hidden className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No notes yet</p>
          <p className="text-xs text-muted-foreground">
            Notes capture the context email loses: client quirks, QBO workarounds, handoff details.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="notes-feed">
          {notes.map((note) => (
            <li
              key={note.id}
              data-testid="note-row"
              className="group rounded-lg border border-border bg-card px-4 py-3"
            >
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                {note.clientName != null ? (
                  <Badge variant="secondary" className="text-[11px] font-medium">
                    {note.clientName}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] font-medium text-muted-foreground">
                    Firm-wide
                  </Badge>
                )}
                <span>{note.authorName}</span>
                <span aria-hidden>·</span>
                <span>{relativeTime(note.createdAt)}</span>
                {note.authorId === currentUserId && (
                  <button
                    type="button"
                    aria-label={`Delete note ${note.id}`}
                    onClick={() => void deleteNote(note.id)}
                    className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
