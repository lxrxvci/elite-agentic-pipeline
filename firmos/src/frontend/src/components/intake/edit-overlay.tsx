'use client'

import { useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/shared/lib/utils'
import type { ContactLookupResults } from '@/server/contact-lookup'
import type { InstitutionRow } from '@/server/institutions'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { PayrollProviderRow } from '@/server/payroll-providers'

import { BehaviorNoteDialog } from './behavior-note-dialog'
import {
  CUSTOM_OTHER_VALUE,
  customAllowed,
  findChapter,
  findQuestion,
  isCustomOtherPick,
  type QuestionDef,
  type WizardAnswers,
} from './registry'
import { QuestionHero, QuestionScreen } from './screens'

/**
 * J4 (V1, meeting #3 00:58:28-00:59:29): the review screen's edit buttons
 * open the question's hero card in this overlay - "clicking Edit dumped him
 * back into the wizard mid-flow ('that's crazy')". The overlay renders the
 * SAME QuestionScreen the wizard does, writes through the SAME apply path
 * (autosave + live quote follow), and closes back to the review, which
 * updates in place. The wizard behind never moves.
 *
 * Pick semantics mirror the wizard's pickOption minus navigation: a select
 * pick applies and closes; custom-"Other" and yes-no-list cards stay open
 * for their Continue; a money-behavior yes opens the mandatory note overlay
 * (J2 E1-E3) scoped to this dialog, and saving the note completes the edit.
 */

export interface EditTarget {
  chapterId: string
  questionId: string
}

export function EditQuestionDialog({
  target,
  answers,
  onApply,
  onClose,
  institutions = [],
  onAddInstitution,
  payrollProviders = [],
  onAddPayrollProvider,
  merchantProcessors = [],
  onAddMerchantProcessor,
  contactSearch = null,
}: {
  target: EditTarget | null
  answers: WizardAnswers
  /** The wizard's apply - patches merge into answers and autosave. */
  onApply: (patch: Partial<WizardAnswers>) => void
  onClose: () => void
  institutions?: InstitutionRow[]
  onAddInstitution?: (name: string) => Promise<InstitutionRow | null>
  payrollProviders?: PayrollProviderRow[]
  onAddPayrollProvider?: (name: string) => Promise<PayrollProviderRow | null>
  merchantProcessors?: MerchantProcessorRow[]
  onAddMerchantProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  contactSearch?: ((query: string) => Promise<ContactLookupResults | null>) | null
}) {
  // The money-behavior yes waiting on its mandatory note, scoped to this
  // overlay (the wizard's own note prompt is a separate, wizard-path state).
  const [noteOpen, setNoteOpen] = useState(false)

  const q = target ? findQuestion(target.chapterId, target.questionId) : undefined
  const chapter = target ? findChapter(target.chapterId) : undefined
  if (!target || !q || !chapter) return null

  const close = () => {
    setNoteOpen(false)
    onClose()
  }

  /** The wizard's pickOption without the navigation: apply, then close -
   *  except for the cards that need a second step inline. */
  const overlayPick = (value: string) => {
    // J2 (E1-E3): a money-behavior yes requires the explanation note first;
    // the answer lands only when the note saves (same rule as the wizard).
    if (q.noteOnYes && value === 'yes') {
      setNoteOpen(true)
      return
    }
    let patch = q.apply(answers, value)
    // A no on a note-on-yes card retires the stored note with it.
    if (q.noteOnYes && value === 'no') {
      const notes = answers.behaviorNotes
      if (notes && notes[q.id] != null) {
        const rest = { ...notes }
        delete rest[q.id]
        patch = { ...patch, behaviorNotes: rest }
      }
    }
    // I1 custom "Other": re-picking a listed option drops the typed text.
    if (customAllowed(q) && value !== CUSTOM_OTHER_VALUE) {
      const custom = answers.customAnswers
      if (custom && custom[q.id] != null) {
        const rest = { ...custom }
        delete rest[q.id]
        patch = { ...patch, customAnswers: rest }
      }
    }
    onApply(patch)
    // "Other - type it" opens the inline input and yes-no-list cards reveal
    // the list editor - Continue (onAdvance) closes those.
    if (isCustomOtherPick(q, value) || q.type === 'yes-no-list') return
    close()
  }

  const saveNote = (text: string) => {
    const patch = q.apply(answers, 'yes')
    onApply({ ...patch, behaviorNotes: { ...(answers.behaviorNotes ?? {}), [q.id]: text } })
    close()
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent
          data-testid="edit-overlay"
          data-question={q.id}
          className={cn(
            'max-h-[85vh] overflow-y-auto',
            // Match the wizard's canvas per screen type: the routine
            // scheduler board gets the wide layout, everything else the
            // standard question-card width.
            q.type === 'routine-scheduler' ? 'sm:max-w-4xl' : 'sm:max-w-2xl',
          )}
        >
          <DialogTitle className="sr-only">{q.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Edit this answer in place - saving updates the review without leaving it.
          </DialogDescription>
          <QuestionHero q={q} answers={answers} titleAs="h2" />
          <div className="mt-5">
            <QuestionScreen
              key={`${target.chapterId}.${target.questionId}`}
              q={q}
              answers={answers}
              onApply={onApply}
              onAdvance={close}
              onPickOption={overlayPick}
              institutions={institutions}
              onAddInstitution={onAddInstitution}
              payrollProviders={payrollProviders}
              onAddPayrollProvider={onAddPayrollProvider}
              merchantProcessors={merchantProcessors}
              onAddMerchantProcessor={onAddMerchantProcessor}
              contactSearch={contactSearch}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* J2 (E1-E3): the blocking explanation overlay for a money-behavior
          yes picked inside the edit overlay. Saving completes the edit and
          closes both; "Go back" discards the pick, keeping the edit open. */}
      {q.noteOnYes && (
        <BehaviorNoteDialog
          questionId={q.id}
          config={q.noteOnYes}
          initialNote={answers.behaviorNotes?.[q.id] ?? null}
          open={noteOpen}
          onSave={saveNote}
          onCancel={() => setNoteOpen(false)}
        />
      )}
    </>
  )
}
