'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import type { Quote } from '@firmos/domain'

import { getQuote, saveIntake } from '@/server/actions/intake'
import { searchContactsAction } from '@/server/actions/contacts'
import { addInstitutionAction, listInstitutionsAction } from '@/server/actions/institutions'
import {
  addMerchantProcessorAction,
  listMerchantProcessorsAction,
} from '@/server/actions/merchant-processors'
import {
  addPayrollProviderAction,
  listPayrollProvidersAction,
} from '@/server/actions/payroll-providers'
import {
  addOptionValueAction,
  listOptionValuesBulkAction,
} from '@/server/actions/option-lists'
import { listServicesCatalogAction } from '@/server/actions/services-catalog'
import { listIndustrySuggestionsAction } from '@/server/actions/industry-suggestions'
import type { IndustrySuggestionRow } from '@/server/industry-suggestions'
import type { ContactLookupResults } from '@/server/contact-lookup'
import type { IntakeRunningNote } from '@/server/intake'
import type { InstitutionRow } from '@/server/institutions'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import type { OptionValueRow } from '@/server/option-lists'
import type { PayrollProviderRow } from '@/server/payroll-providers'
import { cn } from '@/shared/lib/utils'

import type { StaffOption } from './convert-dialog'
import { BehaviorNoteDialog } from './behavior-note-dialog'
import { EditQuestionDialog, type EditTarget } from './edit-overlay'
import { NotesRail } from './notes-rail'
import { QuoteHiddenCard, QuotePanel } from './quote-panel'
import {
  allAccounts,
  buildPatch,
  CUSTOM_OTHER_VALUE,
  customAllowed,
  registerCustomAddonServiceKeys,
  syncLinkedContactCopies,
  type ServiceCatalogRowLite,
  effectiveServiceKeys,
  findChapter,
  findQuestion,
  firstUnansweredScreen,
  flattenScreens,
  isCustomOtherPick,
  questionPosition,
  visibleChapters,
  type WizardAnswers,
} from './registry'
import { ReviewScreen } from './review-screen'
import { QuestionHero, QuestionScreen } from './screens'

/**
 * The conversational client intake wizard: one question per screen on a
 * single page in Jason's dictated order (intake-restructure I1, plan §1),
 * direction-aware transitions, a persistent Back link that never loses
 * answers, debounced autosave through saveIntake, and a persistent live
 * quote priced by the server only. The branch map lives in registry.ts,
 * declarative and tested.
 *
 * J4 harness (meeting 09_30, 00:12:36/00:29:04): NOTHING auto-advances -
 * "take any spot where it automatically clicks through when you select
 * something. We don't need it... We can just click the continue." Every
 * screen moves forward only via its Continue button (or the rail jumps).
 *
 * N3 (meeting #3): the chapter rail under the header is also the section
 * navigator - a nav landmark where every reached chapter (plus the current
 * one) jumps straight to that chapter's first question. Jumps never lose
 * answers (they are already in form_data via autosave) and the resume point
 * can never rewind past answered questions; unreached chapters stay disabled
 * until the walk lands on them. K1 (09_30 00:29:54): hovering a rail tab
 * enlarges it and shows the chapter's questions for a direct jump.
 */

export const SAVE_DEBOUNCE_MS = 800
export const QUOTE_DEBOUNCE_MS = 400

/** K3 (DB1): every option list the intake can render - one bulk read. */
export const INTAKE_OPTION_LIST_KEYS = [
  'referral_sources',
  'tax_structure_customs',
  'accounting_software',
  'payment_methods',
  'property_types',
  'industries',
  'report_types',
  'custom_task_templates',
  'payroll_frequencies',
  'bookkeeping_frequencies',
  'engagement_types',
  'bill_pay_locations',
  // K8 (B4): the roles database behind the contacts role type-ahead.
  'contact_roles',
] as const

/** I4 (plan §3D): the staff peek flag lives in sessionStorage - remembered
 *  per browser session, never across sessions, default hidden. */
export const QUOTE_PEEK_STORAGE_KEY = 'firmos:intake-quote-peek'

function readPeekPreference(): boolean {
  try {
    return sessionStorage.getItem(QUOTE_PEEK_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export type IntakeStatusKey = 'new' | 'in_progress' | 'pending_review' | 'completed' | 'archived'

export interface IntakeWizardProps {
  intakeId: number
  status: IntakeStatusKey
  /** K7 (C2): manual = "we already know everything" - the whole rail is
   *  jumpable from the start (no forced walk). */
  intakeMode?: 'discovery' | 'manual'
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
  intakeMode = 'discovery',
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
  // N3 (meeting #3): direct section navigation. The chapters the walk has
  // REACHED - seeded with everything up to the resume point, so a reopened
  // intake is jumpable everywhere it has already been - plus each chapter as
  // the walk lands on it. Chapter ids (not indexes) so a branch flip that
  // hides chapters never marks an unvisited one as reached.
  const [reachedChapters, setReachedChapters] = useState<ReadonlySet<string>>(() => {
    // K7 (C2): manual-entry mode starts with the whole rail unlocked.
    if (intakeMode === 'manual' && editable) {
      return new Set(visibleChapters(initialAnswers).map((c) => c.id))
    }
    const resumeAt = editable ? (initialScreenIndex ?? firstUnansweredScreen(initialAnswers)) : 0
    const initialScreens = flattenScreens(initialAnswers)
    const reached = new Set<string>()
    for (const c of visibleChapters(initialAnswers)) {
      const firstAt = initialScreens.findIndex((s) => s.kind === 'question' && s.chapterId === c.id)
      if (firstAt >= 0 && firstAt <= resumeAt) reached.add(c.id)
    }
    return reached
  })
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd')
  const [note, setNote] = useState<string | null>(null)
  // J2 (E1-E3): the money-behavior card whose yes-pick is waiting on its
  // mandatory explanation note. Set = the blocking overlay is open; the yes
  // answer is not applied until the note saves.
  const [notePrompt, setNotePrompt] = useState<{ chapterId: string; questionId: string } | null>(null)
  // J4 (V1): the review screen's edit buttons open this overlay - the
  // question's hero card in a dialog, editing in place. The wizard behind
  // never navigates.
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  // I4: pricing stays hidden until the review screen (the client may be
  // watching on the Meet call); staff can peek via the rail toggle, which is
  // remembered per session and defaults to hidden.
  const [peekPricing, setPeekPricing] = useState(readPeekPreference)
  const togglePeekPricing = useCallback((on: boolean) => {
    setPeekPricing(on)
    try {
      sessionStorage.setItem(QUOTE_PEEK_STORAGE_KEY, on ? '1' : '0')
    } catch {
      // sessionStorage unavailable - the peek just won't persist.
    }
  }, [])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // I3: the shared bank list behind the account mini-form dropdowns; an
  // inline add-new lands here in the same session. J1 (DB1): the same
  // pattern for payroll providers and merchant processors.
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([])
  const [payrollProviders, setPayrollProviders] = useState<PayrollProviderRow[]>([])
  const [merchantProcessors, setMerchantProcessors] = useState<MerchantProcessorRow[]>([])
  // K3 (DB1): the universal option lists behind optionsFromList questions.
  const [optionLists, setOptionLists] = useState<Record<string, OptionValueRow[]>>({})
  // K3 (J16): the services catalog behind the services screen.
  const [servicesCatalog, setServicesCatalog] = useState<ServiceCatalogRowLite[] | undefined>(undefined)
  // K6 (D2): industry-driven suggestions for the services screen.
  const [industrySuggestions, setIndustrySuggestions] = useState<IndustrySuggestionRow[]>([])

  useEffect(() => {
    void listOptionValuesBulkAction([...INTAKE_OPTION_LIST_KEYS]).then((res) => {
      if (res.ok) setOptionLists(res.data)
    })
    void listIndustrySuggestionsAction(answersRef.current.industry ?? null).then((res) => {
      if (res.ok) setIndustrySuggestions(res.data)
    })
    void listServicesCatalogAction().then((res) => {
      if (res.ok) {
        setServicesCatalog(res.data)
        // Custom add-ons must survive the services screen's apply filter.
        registerCustomAddonServiceKeys(res.data.filter((r) => r.isAddon).map((r) => r.serviceKey))
      }
    })
    void listInstitutionsAction().then((res) => {
      if (res.ok) setInstitutions(res.data)
    })
    void listPayrollProvidersAction().then((res) => {
      if (res.ok) setPayrollProviders(res.data)
    })
    void listMerchantProcessorsAction().then((res) => {
      if (res.ok) setMerchantProcessors(res.data)
    })
  }, [])

  const addInstitution = useCallback(async (name: string): Promise<InstitutionRow | null> => {
    const res = await addInstitutionAction(name)
    if (!res.ok) return null
    setInstitutions((prev) =>
      prev.some((i) => i.id === res.data.id)
        ? prev
        : [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
    )
    return res.data
  }, [])

  const addPayrollProvider = useCallback(async (name: string): Promise<PayrollProviderRow | null> => {
    const res = await addPayrollProviderAction(name)
    if (!res.ok) return null
    setPayrollProviders((prev) =>
      prev.some((p) => p.id === res.data.id)
        ? prev
        : [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
    )
    return res.data
  }, [])

  const addMerchantProcessor = useCallback(async (name: string): Promise<MerchantProcessorRow | null> => {
    const res = await addMerchantProcessorAction(name)
    if (!res.ok) return null
    setMerchantProcessors((prev) =>
      prev.some((p) => p.id === res.data.id)
        ? prev
        : [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)),
    )
    return res.data
  }, [])

  // K3 (J1/J2): a custom option persists to its list and lands, sorted,
  // in the local copy - "once added through an intake, it stays in the
  // database for future use."
  const addOptionListValue = useCallback(
    async (listKey: string, name: string): Promise<OptionValueRow | null> => {
      const res = await addOptionValueAction(listKey, name)
      if (!res.ok) return null
      setOptionLists((prev) => {
        const current = prev[listKey] ?? []
        if (current.some((v) => v.id === res.data.id)) return prev
        return {
          ...prev,
          [listKey]: [...current, res.data].sort((a, b) => a.name.localeCompare(b.name)),
        }
      })
      return res.data
    },
    [],
  )

  // J1 (C5/C6/C7): the contact pickers' debounced server read.
  const contactSearch = useCallback(
    async (query: string): Promise<ContactLookupResults | null> => {
      const res = await searchContactsAction(query)
      return res.ok ? res.data : null
    },
    [],
  )

  const screens = useMemo(() => flattenScreens(answers), [answers])
  const idx = Math.min(screenIndex, screens.length - 1)
  const screen = screens[idx]
  // I4: the review screen always reveals the quote; elsewhere it shows only
  // while the staff peek toggle is on.
  const isReview = screen?.kind === 'review'
  const quoteVisible = isReview || peekPricing

  const answersRef = useRef(answers)
  answersRef.current = answers
  const dirtyRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
        a: allAccounts(answers),
        m: answers.merchantAccounts ?? [],
        q: answers.serviceQuantities ?? null,
        d: answers.serviceDiscounts ?? null,
        // J4 (V4): direct per-line price overrides reprice like discounts do.
        pr: answers.servicePrices ?? null,
        n: answers.estimated1099Count ?? null,
        c: answers.customItems ?? [],
        // K6 (D6): the retro bulk discount reprices the cleanup block.
        rd2: answers.retroDiscountPercent ?? null,
        // Specialty report definitions move the quote when priced (C10).
        rd: answers.reportDefinitions ?? [],
        // QBO tier inputs and the retroactive scope move the quote too.
        qb: answers.quickbooksStatus ?? null,
        u: answers.qboUserCount ?? null,
        t: answers.qboSubscriptionTier ?? null,
        sd: answers.bookkeepingStartDate ?? null,
      }),
    [answers],
  )

  // D2: the suggestions follow the industry answer.
  const industryKey = answers.industry ?? ''
  useEffect(() => {
    void listIndustrySuggestionsAction(industryKey === '' ? null : industryKey).then((res) => {
      if (res.ok) setIndustrySuggestions(res.data)
    })
  }, [industryKey])

  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => {
      setQuoteLoading(true)
      const a = answersRef.current
      void getQuote({ ...a, accounts: allAccounts(a), serviceKeys: effectiveServiceKeys(a) }).then((res) => {
        setQuoteLoading(false)
        if (res.ok) setQuote(res.data)
      })
    }, QUOTE_DEBOUNCE_MS)
  }, [quoteKey])

  // ── Navigation ──
  const apply = useCallback(
    (patch: Partial<WizardAnswers>) => {
      setAnswers((prev) => {
        const next = { ...prev, ...patch }
        // K4 (B7, 09_30 00:06:59): linked contact copies follow the
        // canonical store - edit the primary contact once and the linked
        // owner card shows it too.
        const sync = syncLinkedContactCopies(next)
        return sync ? { ...next, ...sync } : next
      })
      if (editable) scheduleSave()
    },
    [editable, scheduleSave],
  )

  // Running notes (the rail): appended into answers like any other field, so
  // the debounced autosave carries them into form_data.runningNotes.
  const addRunningNote = useCallback(
    (text: string) => {
      const entry: IntakeRunningNote = { text, at: new Date().toISOString() }
      apply({ runningNotes: [...(answersRef.current.runningNotes ?? []), entry] })
    },
    [apply],
  )

  const go = useCallback(
    (dir: 'fwd' | 'back') => {
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
      // J2 (E1-E3): a yes on a money-behavior card opens the blocking note
      // overlay INSTEAD of applying - the answer lands only when the note
      // saves (behavior-note-dialog.tsx).
      if (q.noteOnYes && value === 'yes') {
        setNotePrompt(screen!.kind === 'question' ? { chapterId: screen.chapterId, questionId: q.id } : null)
        return
      }
      let patch = q.apply(answersRef.current, value)
      // A no on a note-on-yes card retires the stored note with it.
      if (q.noteOnYes && value === 'no') {
        const notes = answersRef.current.behaviorNotes
        if (notes && notes[q.id] != null) {
          const rest = { ...notes }
          delete rest[q.id]
          patch = { ...patch, behaviorNotes: rest }
        }
      }
      // I1 custom "Other": re-picking a listed option drops the typed text.
      if (customAllowed(q) && value !== CUSTOM_OTHER_VALUE) {
        const custom = answersRef.current.customAnswers
        if (custom && custom[q.id] != null) {
          const rest = { ...custom }
          delete rest[q.id]
          patch = { ...patch, customAnswers: rest }
        }
      }
      apply(patch)
      // J4 harness (09_30): no advance on any pick - the inline custom input
      // (Other), the yes-no-list editor, and option notes all reveal in
      // place; Continue is the only way forward.
      if (isCustomOtherPick(q, value) || q.type === 'yes-no-list') {
        setNote(null)
        return
      }
      const optionNote = q.options?.find((o) => o.value === value)?.note ?? null
      setNote(optionNote)
    },
    [apply, screen],
  )

  // J2 (E1-E3): the note saves the yes answer (plus form_data.behaviorNotes)
  // and closes the overlay; "Go back" discards the pick entirely. J4 harness:
  // no advance after the save either - the card shows its yes and waits for
  // Continue like every other screen.
  const saveBehaviorNote = useCallback(
    (text: string) => {
      if (!notePrompt) return
      const q = findQuestion(notePrompt.chapterId, notePrompt.questionId)
      if (!q) return
      const patch = q.apply(answersRef.current, 'yes')
      apply({ ...patch, behaviorNotes: { ...(answersRef.current.behaviorNotes ?? {}), [q.id]: text } })
      setNotePrompt(null)
    },
    [notePrompt, apply],
  )
  const noteQuestion = notePrompt ? findQuestion(notePrompt.chapterId, notePrompt.questionId) : undefined

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

  // N3: a chapter-rail jump lands on the chapter's first visible question.
  // Answers ride form_data either way - the autosave flushes before the move
  // (the same guarantee Continue/Back make), and the resume point only ever
  // looks forward for unanswered REQUIRED questions, so jumping can never
  // rewind it past answered ones.
  const jumpToChapter = useCallback(
    (chapterId: string) => {
      const target = screens.findIndex((s) => s.kind === 'question' && s.chapterId === chapterId)
      if (target < 0 || target === idx) return
      setDirection(target < idx ? 'back' : 'fwd')
      setNote(null)
      setScreenIndex(target)
      if (editable) void flushSave()
    },
    [editable, flushSave, idx, screens],
  )

  // J4 (V1): review edits open the overlay, never the wizard. Closing flushes
  // the autosave so the edit is durable even if the intake is closed next.
  const openEditor = useCallback((chapterId: string, questionId: string) => {
    setEditTarget({ chapterId, questionId })
  }, [])
  const closeEditor = useCallback(() => {
    setEditTarget(null)
    if (editable) void flushSave()
  }, [editable, flushSave])

  // J4 (V4): direct per-line price editing (per billing cycle). A number
  // writes the servicePrices override; null resets to the standard price,
  // clearing the override AND any legacy discount on that line.
  const changeServicePrice = useCallback(
    (serviceKey: string, dollars: number | null) => {
      const prices = { ...(answersRef.current.servicePrices ?? {}) }
      const discounts = { ...(answersRef.current.serviceDiscounts ?? {}) }
      if (dollars == null) {
        delete prices[serviceKey]
        delete discounts[serviceKey]
      } else {
        prices[serviceKey] = dollars
      }
      apply({ servicePrices: prices, serviceDiscounts: discounts })
    },
    [apply],
  )

  // ── Progress header ──
  const chapters = useMemo(() => visibleChapters(answers), [answers])
  const position =
    screen?.kind === 'question' ? questionPosition(answers, screen) : null
  const currentChapterId = screen?.kind === 'question' ? screen.chapterId : null
  const currentChapterIndex = chapters.findIndex((c) => c.id === currentChapterId)

  // K1 (09_30 00:29:54 + 00:01:02): each rail tab's hover dropdown - the
  // chapter's visible questions in walk order for a direct jump ("if there's
  // multiple slides in one of these, a drop down pops up").
  const chapterQuestions = useMemo(() => {
    const map = new Map<string, { questionId: string; title: string }[]>()
    for (const s of screens) {
      if (s.kind !== 'question') continue
      const q = findQuestion(s.chapterId, s.questionId)
      if (!q) continue
      const list = map.get(s.chapterId) ?? []
      list.push({ questionId: s.questionId, title: q.title })
      map.set(s.chapterId, list)
    }
    return map
  }, [screens])

  // N3: landing on a chapter marks it reached (jumpable from the rail);
  // reaching the review screen unlocks every visible chapter - the walk
  // passed them all to get there.
  useEffect(() => {
    setReachedChapters((prev) => {
      if (screen?.kind === 'review') {
        return chapters.every((c) => prev.has(c.id))
          ? prev
          : new Set([...prev, ...chapters.map((c) => c.id)])
      }
      if (screen?.kind === 'question' && !prev.has(screen.chapterId)) {
        const next = new Set(prev)
        next.add(screen.chapterId)
        return next
      }
      return prev
    })
  }, [screen, chapters])

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* J3: the routine-scheduler board gets more room than a question card. */}
        <div
          className={cn(
            'mx-auto w-full min-w-0',
            screen?.kind === 'question' && screen.questionId === 'routine-scheduler'
              ? 'max-w-4xl'
              : 'max-w-2xl',
          )}
        >
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

            {/* N3 (meeting #3): the chapter rail doubles as direct section
                navigation. Reached chapters (and the current one) jump
                straight to the chapter's first question without losing
                answers; chapters the walk has not reached stay disabled
                (Continue is the only way forward). The visual meaning is
                unchanged: filled = completed, half = current, empty = upcoming. */}
            <nav aria-label="Intake sections" className="mt-3" data-testid="chapter-rail">
              <ol className="flex gap-1.5">
                {chapters.map((c, i) => {
                  const state =
                    screen?.kind === 'review' || i < currentChapterIndex
                      ? 'done'
                      : i === currentChapterIndex
                        ? 'current'
                        : 'upcoming'
                  const jumpable =
                    screen?.kind === 'review' || reachedChapters.has(c.id) || i === currentChapterIndex
                  const qList = chapterQuestions.get(c.id) ?? []
                  return (
                    <li key={c.id} className="group relative min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={!jumpable}
                        onClick={() => jumpToChapter(c.id)}
                        aria-current={i === currentChapterIndex ? 'step' : undefined}
                        aria-label={
                          state === 'done'
                            ? `${c.label} (completed)`
                            : state === 'current'
                              ? `${c.label} (current)`
                              : jumpable
                                ? c.label
                                : `${c.label} (not reached yet)`
                        }
                        title={jumpable ? `Jump to ${c.label}` : `${c.label} - not reached yet`}
                        data-testid={`chapter-jump-${c.id}`}
                        data-state={state}
                        className="block w-full rounded-sm py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
                      >
                        {/* K1: tabs grow on hover so they read as interactive. */}
                        <span
                          className={cn(
                            'block h-1.5 w-full rounded-full transition-all duration-300 group-hover:h-2.5',
                            state === 'done'
                              ? 'bg-firm-brand'
                              : state === 'current'
                                ? 'bg-firm-brand/50'
                                : 'bg-border',
                            jumpable && 'group-hover:bg-firm-brand-strong group-focus-visible:bg-firm-brand-strong',
                          )}
                        />
                      </button>
                      {/* K1 (A4/A2): hover/focus reveals the chapter name and
                          its slides ("Every card should be an option if
                          there's a name for the card") - a direct jump to
                          any reached slide, not just the chapter's first. */}
                      {jumpable && (
                        <div className="pointer-events-none absolute left-1/2 top-full z-30 w-56 -translate-x-1/2 pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                          <div
                            className="overflow-hidden rounded-lg border border-border bg-popover shadow-pop"
                            data-testid={`chapter-menu-${c.id}`}
                          >
                            <p className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
                              {c.label}
                            </p>
                            <ul className="max-h-64 overflow-y-auto py-1">
                              {qList.map((item) => (
                                <li key={item.questionId}>
                                  <button
                                    type="button"
                                    onClick={() => jumpTo(c.id, item.questionId)}
                                    data-testid={`chapter-menu-item-${c.id}-${item.questionId}`}
                                    className="block w-full truncate px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none"
                                  >
                                    {item.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </nav>
            {position && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="progress-label">
                {position.chapterLabel}, {position.index} of {position.count}
              </p>
            )}
          </div>

          {/* Screen: one question per card on the cool-gray canvas
              (DESIGN-FRESHBOOKS §5 - carded steps). */}
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
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
                    <QuestionHero q={q} answers={answers} />
                    <div className="mt-5">
                      <QuestionScreen
                        key={`${screen.chapterId}.${screen.questionId}`}
                        q={q}
                        answers={answers}
                        onApply={apply}
                        onAdvance={() => go('fwd')}
                        onPickOption={(v) => pickOption(q.id, v)}
                        institutions={institutions}
                        onAddInstitution={addInstitution}
                        payrollProviders={payrollProviders}
                        onAddPayrollProvider={addPayrollProvider}
                        merchantProcessors={merchantProcessors}
                        onAddMerchantProcessor={addMerchantProcessor}
                        contactSearch={contactSearch}
                        optionLists={optionLists}
                        onAddOptionListValue={addOptionListValue}
                        servicesCatalog={servicesCatalog}
                        industrySuggestions={industrySuggestions}
                      />
                    </div>
                    {note && (
                      <p className="mt-4 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground" role="note">
                        {note}
                      </p>
                    )}
                  </div>
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
                onEdit={openEditor}
                onPriceChange={changeServicePrice}
                onRetroDiscountChange={(percent) => apply({ retroDiscountPercent: percent })}
                onCustomWork={apply}
                customTaskCatalog={optionLists.custom_task_templates ?? []}
                onAddCustomTaskTitle={(name) => void addOptionListValue('custom_task_templates', name)}
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

        {/* Right rail: the live quote (I4: hidden until the review screen,
            staff-peekable via the rail toggle) above the running-notes rail.
            J4 (V3, meeting #3 01:01:22): the rail is ONE sticky unit on large
            screens - the notes box scrolls WITH the pricing card instead of
            being stranded at the top of a long review ("you can't enter
            notes when scrolled"). Taller-than-viewport rails scroll
            internally. The quote panel also captures per-line price
            overrides (J4/V4) - edits apply into answers, so autosave +
            repricing follow like any other answer. The review screen is the
            reveal. */}
        <div
          className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
          data-testid="wizard-rail"
        >
          {quoteVisible ? (
            <QuotePanel
              quote={quote}
              loading={quoteLoading}
              onPriceChange={changeServicePrice}
              onHidePricing={
                isReview ? undefined : () => togglePeekPricing(false)
              }
              reveal={isReview}
            />
          ) : (
            <QuoteHiddenCard onShow={() => togglePeekPricing(true)} />
          )}
          <NotesRail notes={answers.runningNotes ?? []} onAdd={addRunningNote} />
        </div>
      </div>

      {/* J2 (E1-E3): the blocking explanation overlay behind a
          money-behavior yes. Rendered at the wizard root so it freezes the
          whole page; the card underneath stays unanswered until the note
          saves. */}
      {noteQuestion?.noteOnYes && (
        <BehaviorNoteDialog
          questionId={noteQuestion.id}
          config={noteQuestion.noteOnYes}
          initialNote={answers.behaviorNotes?.[noteQuestion.id] ?? null}
          open
          onSave={saveBehaviorNote}
          onCancel={() => setNotePrompt(null)}
        />
      )}

      {/* J4 (V1): the review screen's edit overlay - the question's hero
          card in a dialog, writing through the same apply/autosave path. */}
      <EditQuestionDialog
        target={editTarget}
        answers={answers}
        onApply={apply}
        onClose={closeEditor}
        institutions={institutions}
        onAddInstitution={addInstitution}
        payrollProviders={payrollProviders}
        onAddPayrollProvider={addPayrollProvider}
        merchantProcessors={merchantProcessors}
        onAddMerchantProcessor={addMerchantProcessor}
        contactSearch={contactSearch}
        optionLists={optionLists}
        onAddOptionListValue={addOptionListValue}
      />
    </div>
  )
}
