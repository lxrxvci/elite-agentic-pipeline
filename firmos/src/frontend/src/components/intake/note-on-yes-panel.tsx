'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/shared/lib/utils'

import { inputCls } from './account-screens'
import type { QuestionDef, WizardAnswers } from './registry'

/**
 * L1 (C1/C2, 10_06 00:12:26-00:14:53): the behavior note lives IN the hero
 * card as a drop-down panel tied to the yes pick - "notes are tied to the
 * hero card and persist across form states," in a drop-down box rather than
 * an overlay. It stays editable forever, and toggling no HIDES it (the
 * panel unmounts) without deleting the stored note - toggling back to yes
 * restores every word.
 *
 * The J2 mandatory rule (09_27): the panel is required, not optional - the
 * screen's Continue refuses until the note says something (the gate lives
 * in the select screen's advance handler).
 */
export function NoteOnYesPanel({
  q,
  answers,
  onApply,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
}) {
  const cfg = q.noteOnYes!
  const saved = (answers.behaviorNotes?.[q.id] as string | undefined) ?? ''
  const [text, setText] = useState(saved)
  // Re-seed only when the question changes - never mid-typing on this card.
  useEffect(() => {
    setText(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id])

  const commit = (value: string) => {
    onApply({ behaviorNotes: { ...(answers.behaviorNotes ?? {}), [q.id]: value } })
  }

  const empty = text.trim() === ''
  return (
    <div
      className="rounded-xl border border-firm-brand/40 bg-accent/30 p-4"
      data-testid={`note-panel-${q.id}`}
    >
      <label htmlFor={`note-${q.id}`} className="block text-sm font-semibold text-foreground">
        {cfg.heading}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{cfg.body}</p>
      <textarea
        id={`note-${q.id}`}
        data-testid={`note-input-${q.id}`}
        className={cn(inputCls, 'mt-2.5 h-auto min-h-20 py-2')}
        placeholder={cfg.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
      />
      <p className={cn('mt-1.5 text-[11px]', empty ? 'font-medium text-status-overdue' : 'text-muted-foreground')}>
        {empty ? 'Required - the card can\u2019t move on without it.' : 'Saved to the card - edit it anytime.'}
      </p>
    </div>
  )
}
