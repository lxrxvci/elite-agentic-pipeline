'use client'

import { useEffect, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/lib/utils'
import type { ContactLookupResults } from '@/server/contact-lookup'
import type { InstitutionRow } from '@/server/institutions'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { PayrollProviderRow } from '@/server/payroll-providers'

import {
  CUSTOM_OTHER_VALUE,
  customAllowed,
  findChapter,
  findQuestion,
  isCustomOtherPick,
  visibleQuestions,
  type OptionListValueLite,
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
  /** L1 (G1, 10_06 01:03:07): the section-header Edit walks EVERY question
   *  in the chapter in sequence ("it should walk you through all those
   *  options"); a row pencil edits its single question (walk unset). */
  walk?: boolean
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
  optionLists,
  onAddOptionListValue,
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
  /** K3: the option lists behind optionsFromList questions (from the wizard). */
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  // L1 (C2, 10_06 00:12:26): the note rides the in-card panel inside the
  // dialog - no overlay-level note state anymore.
  // L1 (G1): walk mode - the current question within the chapter's visible
  // list. Tracks the prop's questionId until the user steps.
  const [stepQid, setStepQid] = useState<string | null>(null)
  useEffect(() => {
    setStepQid(target?.questionId ?? null)
  }, [target?.chapterId, target?.questionId])

  const chapter = target ? findChapter(target.chapterId) : undefined
  // Walk list: the chapter's currently-visible questions (recomputed as
  // edits apply - a conditional card can appear or vanish mid-walk).
  const walkQs = target?.walk && chapter ? visibleQuestions(chapter, answers) : []
  const activeQid = target?.walk ? (stepQid ?? target.questionId) : target?.questionId
  const q = activeQid ? findQuestion(target!.chapterId, activeQid) : undefined
  if (!target || !q || !chapter) return null
  if (target.walk && walkQs.length === 0) return null
  const stepIdx = target.walk ? Math.max(0, walkQs.findIndex((wq) => wq.id === q.id)) : 0
  const isFirst = stepIdx <= 0
  const isLast = stepIdx >= walkQs.length - 1

  const close = () => {
    onClose()
  }

  /** L1 (G1): walk mode advances to the next question; single-question
   *  edits and the last walk question close. */
  const advanceOrClose = () => {
    if (target.walk && !isLast) {
      setStepQid(walkQs[stepIdx + 1].id)
      return
    }
    close()
  }
  const stepBack = () => {
    if (target.walk && !isFirst) {
      setStepQid(walkQs[stepIdx - 1].id)
    }
  }

  /** The wizard's pickOption without the navigation: apply, then close (or
   *  advance in walk mode) - except for the cards that need a second step
   *  inline. */
  const overlayPick = (value: string) => {
    // L1 (C2, 10_06 00:12:26): a yes on a note-on-yes card applies and STAYS
    // - the in-card note panel renders below the pick (no blocking overlay);
    // the screen's gated Continue enforces the mandatory rule and advances.
    if (q.noteOnYes && value === 'yes') {
      onApply(q.apply(answers, value))
      return
    }
    let patch = q.apply(answers, value)
    // L1 (C1): a no on a note-on-yes card HIDES the note, never deletes it -
    // re-picking yes restores it.
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
    // the list editor - Continue (onAdvance) moves past those.
    if (isCustomOtherPick(q, value) || q.type === 'yes-no-list') return
    advanceOrClose()
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
          {/* L1 (G1): walk progress + back navigation for the chapter stepper. */}
          {target.walk && (
            <div className="mb-3 flex items-center justify-between" data-testid="edit-walk-nav">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="edit-walk-back"
                disabled={isFirst}
                onClick={stepBack}
              >
                Back
              </Button>
              <span className="tnum text-xs text-muted-foreground" data-testid="edit-walk-progress">
                {stepIdx + 1} of {walkQs.length}
              </span>
            </div>
          )}
          <QuestionHero q={q} answers={answers} titleAs="h2" />
          <div className="mt-5">
            <QuestionScreen
              key={`${target.chapterId}.${q.id}`}
              q={q}
              answers={answers}
              onApply={onApply}
              onAdvance={advanceOrClose}
              onPickOption={overlayPick}
              institutions={institutions}
              onAddInstitution={onAddInstitution}
              payrollProviders={payrollProviders}
              onAddPayrollProvider={onAddPayrollProvider}
              merchantProcessors={merchantProcessors}
              onAddMerchantProcessor={onAddMerchantProcessor}
              contactSearch={contactSearch}
              optionLists={optionLists}
              onAddOptionListValue={onAddOptionListValue}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
