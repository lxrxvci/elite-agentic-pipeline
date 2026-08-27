'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import type { Quote } from '@firmos/domain'

import { getQuote, saveIntake } from '@/server/actions/intake'
import { cn } from '@/shared/lib/utils'

import type { StaffOption } from './convert-dialog'
import { QuotePanel } from './quote-panel'
import {
  buildPatch,
  effectiveServiceKeys,
  findChapter,
  findQuestion,
  firstUnansweredScreen,
  flattenScreens,
  questionPosition,
  visibleChapters,
  type WizardAnswers,
} from './registry'
import { ReviewScreen } from './review-screen'
import { QuestionScreen } from './screens'

/**
 * The conversational client intake wizard (HANDOFF §10): one question per
 * screen on a single page, option picks auto-advance, direction-aware
 * transitions, a persistent Back link that never loses answers, debounced
 * autosave through saveIntake, and a persistent live quote priced by the
 * server only. The branch map lives in registry.ts, declarative and tested.
 */

export const AUTO_ADVANCE_MS = 180
export const NOTE_DWELL_MS = 2400
export const SAVE_DEBOUNCE_MS = 800
export const QUOTE_DEBOUNCE_MS = 400

export type IntakeStatusKey = 'new' | 'in_progress' | 'pending_review' | 'completed' | 'archived'

export interface IntakeWizardProps {
  intakeId: number
  status: IntakeStatusKey
  initialAnswers: WizardAnswers
  initialScreenIndex?: number
  canConvert: boolean
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  clientId: number | null
}

export function IntakeWizard({
  intakeId,
  status,
  initialAnswers,
  initialScreenIndex,
  canConvert,
  managers,
  bookkeepers,
  clientId,
}: IntakeWizardProps) {
  // The status at mount drives editability for the whole session: after a
  // submit, revalidatePath flips the prop to pending_review, but the wizard
  // must keep showing its success state instead of clobbering it.
  const [liveStatus] = useState(status)
  const editable = liveStatus === 'new' || liveStatus === 'in_progress'
  const [answers, setAnswers] = useState<WizardAnswers>(initialAnswers)
  const [screenIndex, setScreenIndex] = useState(() =>
    editable ? (initialScreenIndex ?? firstUnansweredScreen(initialAnswers)) : 0,
  )
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd')
  const [note, setNote] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const screens = useMemo(() => flattenScreens(answers), [answers])
  const idx = Math.min(screenIndex, screens.length - 1)
  const screen = screens[idx]

  const answersRef = useRef(answers)
  answersRef.current = answers
  const dirtyRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Autosave (debounced; flushes before advancing screens) ──
  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setSaveState('saving')
    const res = await saveIntake({ intakeId, patch: buildPatch(answersRef.current) })
    setSaveState(res.ok ? 'saved' : 'error')
  }, [intakeId])

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }, [flushSave])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
      if (quoteTimer.current) clearTimeout(quoteTimer.current)
    }
  }, [])

  // ── Live quote (server-side pricing only, debounced) ──
  const quoteKey = useMemo(
    () =>
      JSON.stringify({
        s: effectiveServiceKeys(answers),
        f: answers.bookkeepingFrequency ?? null,
        p: answers.payrollFrequency ?? null,
        a: answers.accounts ?? [],
        m: answers.merchantAccounts ?? [],
        q: answers.serviceQuantities ?? null,
        n: answers.estimated1099Count ?? null,
        c: answers.customItems ?? [],
        // QBO tier inputs and the retroactive scope move the quote too.
        qb: answers.quickbooksStatus ?? null,
        u: answers.qboUserCount ?? null,
        t: answers.qboSubscriptionTier ?? null,
        sd: answers.bookkeepingStartDate ?? null,
      }),
    [answers],
  )

  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => {
      setQuoteLoading(true)
      const a = answersRef.current
      void getQuote({ ...a, serviceKeys: effectiveServiceKeys(a) }).then((res) => {
        setQuoteLoading(false)
        if (res.ok) setQuote(res.data)
      })
    }, QUOTE_DEBOUNCE_MS)
  }, [quoteKey])

  // ── Navigation ──
  const apply = useCallback(
    (patch: Partial<WizardAnswers>) => {
      setAnswers((prev) => ({ ...prev, ...patch }))
      if (editable) scheduleSave()
    },
    [editable, scheduleSave],
  )

  const go = useCallback(
    (dir: 'fwd' | 'back') => {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current)
        advanceTimer.current = null
      }
      setDirection(dir)
      setNote(null)
      setScreenIndex((i) =>
        Math.max(0, Math.min(i + (dir === 'fwd' ? 1 : -1), screens.length - 1)),
      )
      if (editable) void flushSave()
    },
    [editable, flushSave, screens.length],
  )

  const pickOption = useCallback(
    (questionId: string, value: string) => {
      const q = screen?.kind === 'question' ? findQuestion(screen.chapterId, screen.questionId) : undefined
      if (!q || q.id !== questionId) return
      apply(q.apply(answersRef.current, value))
      const optionNote = q.options?.find((o) => o.value === value)?.note ?? null
      setNote(optionNote)
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(
        () => go('fwd'),
        optionNote ? NOTE_DWELL_MS : AUTO_ADVANCE_MS,
      )
    },
    [apply, go, screen],
  )

  const jumpTo = useCallback(
    (chapterId: string, questionId: string) => {
      const target = screens.findIndex(
        (s) => s.kind === 'question' && s.chapterId === chapterId && s.questionId === questionId,
      )
      if (target < 0) return
      setDirection(target < idx ? 'back' : 'fwd')
      setNote(null)
      setScreenIndex(target)
    },
    [idx, screens],
  )

  // ── Progress header ──
  const chapters = useMemo(() => visibleChapters(answers), [answers])
  const position =
    screen?.kind === 'question' ? questionPosition(answers, screen) : null
  const currentChapterId = screen?.kind === 'question' ? screen.chapterId : null
  const currentChapterIndex = chapters.findIndex((c) => c.id === currentChapterId)

  const reviewStatus =
    liveStatus === 'pending_review' ? 'pending_review' : liveStatus === 'completed' ? 'completed' : liveStatus === 'archived' ? 'archived' : 'draft'

  // Read-only intake (pending_review / completed / archived): review screen only.
  if (!editable) {
    return (
      <div className="mx-auto max-w-3xl pb-16">
        <ReviewScreen
          intakeId={intakeId}
          answers={answers}
          quote={quote}
          status={reviewStatus}
          canConvert={canConvert}
          managers={managers}
          bookkeepers={bookkeepers}
          clientId={clientId}
          onEdit={jumpTo}
        />
      </div>
    )
  }

  return (
    <div className="pb-24 lg:pb-10">
      <style>{`
        .fi-enter-fwd { animation: fi-slide-fwd 200ms ease-out both; }
        .fi-enter-back { animation: fi-slide-back 200ms ease-out both; }
        @keyframes fi-slide-fwd {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes fi-slide-back {
          from { opacity: 0; transform: translateX(-24px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fi-enter-fwd, .fi-enter-back { animation: none; }
        }
      `}</style>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* Progress header */}
          <div className="mb-5">
            <div className="flex items-center justify-between gap-4">
              <Link
                href="/intake"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                All intakes
              </Link>
              <span
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                role="status"
                data-testid="save-indicator"
              >
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && (
                  <>
                    <Check className="h-3 w-3 text-status-on-track" aria-hidden />
                    Saved
                  </>
                )}
                {saveState === 'error' && (
                  <span className="font-medium text-status-overdue">Save failed - trying again on your next change</span>
                )}
              </span>
            </div>

            <div className="mt-3 flex gap-1.5" aria-hidden>
              {chapters.map((c, i) => (
                <span
                  key={c.id}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors duration-300',
                    screen?.kind === 'review' || i < currentChapterIndex
                      ? 'bg-firm-brand'
                      : i === currentChapterIndex
                        ? 'bg-firm-brand/50'
                        : 'bg-border',
                  )}
                />
              ))}
            </div>
            {position && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="progress-label">
                {position.chapterLabel}, {position.index} of {position.count}
              </p>
            )}
          </div>

          {/* Screen */}
          {screen?.kind === 'question' ? (
            <div
              key={`${screen.chapterId}.${screen.questionId}`}
              className={direction === 'fwd' ? 'fi-enter-fwd' : 'fi-enter-back'}
              data-testid="question-screen"
              data-question={screen.questionId}
            >
              {(() => {
                const q = findQuestion(screen.chapterId, screen.questionId)
                const chapter = findChapter(screen.chapterId)
                if (!q || !chapter) return null
                return (
                  <>
                    <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                      {q.title}
                    </h1>
                    {q.help && <p className="mt-1.5 text-sm text-muted-foreground">{q.help}</p>}
                    <div className="mt-5">
                      <QuestionScreen
                        key={`${screen.chapterId}.${screen.questionId}`}
                        q={q}
                        answers={answers}
                        onApply={apply}
                        onAdvance={() => go('fwd')}
                        onPickOption={(v) => pickOption(q.id, v)}
                      />
                    </div>
                    {note && (
                      <p className="mt-4 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground" role="note">
                        {note}
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
          ) : (
            <div key="review" className={direction === 'fwd' ? 'fi-enter-fwd' : 'fi-enter-back'}>
              <h1 className="mb-5 font-display text-2xl font-semibold tracking-tight text-foreground">
                Review and submit
              </h1>
              <ReviewScreen
                intakeId={intakeId}
                answers={answers}
                quote={quote}
                status="draft"
                canConvert={canConvert}
                managers={managers}
                bookkeepers={bookkeepers}
                clientId={clientId}
                onEdit={jumpTo}
              />
            </div>
          )}

          {/* Persistent back link */}
          {idx > 0 && screen?.kind !== 'review' && (
            <button
              type="button"
              onClick={() => go('back')}
              data-testid="back-link"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
          )}
          {screen?.kind === 'review' && (
            <button
              type="button"
              onClick={() => go('back')}
              data-testid="back-link"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to questions
            </button>
          )}
        </div>

        <QuotePanel quote={quote} loading={quoteLoading} />
      </div>
    </div>
  )
}
