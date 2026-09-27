'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { inputCls } from './account-screens'
import type { NoteOnYesDef } from './registry'

/**
 * J2 (meeting #3, E1-E3, 00:25:34-00:27:56): the mandatory explanation
 * overlay behind a money-behavior "yes". Page-freezing and non-optional -
 * Escape, outside clicks, and the corner close are all suppressed; the only
 * exits are "Save note" (needs real text) or "Go back" (discards the yes
 * pick entirely, leaving the question unanswered). The wizard applies the
 * yes answer plus form_data.behaviorNotes[questionId] on save, then
 * advances.
 */
export function BehaviorNoteDialog({
  questionId,
  config,
  initialNote,
  open,
  onSave,
  onCancel,
}: {
  questionId: string
  config: NoteOnYesDef
  /** Existing note when the yes is revisited (edit path). */
  initialNote?: string | null
  open: boolean
  onSave: (note: string) => void
  /** Explicit discard-the-pick exit; implicit dismissal never fires. */
  onCancel: () => void
}) {
  const [text, setText] = useState(initialNote ?? '')
  const [error, setError] = useState<string | null>(null)

  // Reopenings (a different card's yes, or a revisit) reseed the draft.
  useEffect(() => {
    if (open) {
      setText(initialNote ?? '')
      setError(null)
    }
  }, [open, initialNote, questionId])

  const trimmed = text.trim()
  const save = () => {
    if (trimmed === '') {
      setError('A short note is required here - one sentence is enough.')
      return
    }
    onSave(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Blocking: implicit closes (Escape, overlay click) never dismiss.
        // The explicit exits own the state.
        if (!next) return
      }}
    >
      <DialogContent
        hideClose
        data-testid="behavior-note-dialog"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{config.heading}</DialogTitle>
          <DialogDescription>{config.body}</DialogDescription>
        </DialogHeader>
        <div>
          <label
            htmlFor={`behavior-note-${questionId}`}
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            The explanation (required)
          </label>
          <textarea
            id={`behavior-note-${questionId}`}
            data-testid="behavior-note-input"
            className={`${inputCls} h-auto min-h-24 py-2`}
            placeholder={config.placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value.trim() !== '') setError(null)
            }}
          />
          {error && (
            <p className="mt-2 text-sm font-medium text-status-overdue" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <button
            type="button"
            onClick={onCancel}
            data-testid="behavior-note-cancel"
            className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Go back
          </button>
          <Button
            type="button"
            variant="action"
            onClick={save}
            disabled={trimmed === ''}
            data-testid="behavior-note-save"
          >
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
