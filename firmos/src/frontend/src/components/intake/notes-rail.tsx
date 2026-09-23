'use client'

import { useState } from 'react'
import { NotebookPen, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { IntakeRunningNote } from '@/server/intake'

/**
 * The running-notes rail (Jason's ask: capture tangents mid-intake without
 * losing your place). Visible on every wizard step next to the live quote;
 * notes append into the wizard answers and ride the normal debounced
 * autosave into form_data.runningNotes, so they survive reloads, render on
 * the review screen, and convert into client notes.
 */

/** "Sep 23, 2:41 PM" - display-only; the stored value stays the ISO string. */
const noteStamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function noteLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : noteStamp.format(d)
}

export function NotesRail({
  notes,
  onAdd,
}: {
  notes: IntakeRunningNote[]
  onAdd: (text: string) => void
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <aside
      className="rounded-xl border border-border bg-card shadow-card"
      data-testid="running-notes"
      aria-label="Running notes"
    >
      <div className="px-4 py-3.5 lg:px-5 lg:py-4">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <NotebookPen className="h-3.5 w-3.5" aria-hidden />
          Running notes
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tangents and asides, without leaving the question.
        </p>

        <div className="mt-3 space-y-2">
          <label htmlFor="running-note-input" className="sr-only">
            Add a running note
          </label>
          <textarea
            id="running-note-input"
            data-testid="running-note-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                add()
              }
            }}
            placeholder="e.g. Owner mentioned a second LLC…"
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <Button
            type="button"
            variant="action"
            size="sm"
            className="h-8 w-full text-xs"
            disabled={draft.trim() === ''}
            onClick={add}
            data-testid="running-note-add"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add note
          </Button>
        </div>

        {notes.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-border pt-3" aria-label="Notes so far">
            {[...notes].reverse().map((n, i) => (
              <li
                key={`${n.at}-${notes.length - 1 - i}`}
                data-testid="running-note"
                className="rounded-lg bg-muted px-2.5 py-2"
              >
                <p className="text-xs text-foreground">{n.text}</p>
                <p className="tnum mt-1 text-[10px] text-muted-foreground">{noteLabel(n.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
