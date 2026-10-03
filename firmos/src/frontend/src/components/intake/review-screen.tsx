'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Mail, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { Quote } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { sendIntakeQuoteEmailAction } from '@/server/actions/correspondence'
import { checkDuplicates, submitIntakeForReview } from '@/server/actions/intake'
import type { DuplicateCandidate, IntakeAccountInput } from '@/server/intake'
import { monthLabel } from '@/shared/lib/date-display'
import { accountLabel, normalizeLast4 } from '@/shared/lib/account-label'
import { ROUTINE_BUCKET_LABELS } from '@/shared/lib/routine-schedule'
import { cn } from '@/shared/lib/utils'

import { ConvertDialog, type StaffOption } from './convert-dialog'
import { formatMoney } from './format'
import { noteLabel } from './notes-rail'
import { PriceEditControl } from './price-edit'
import {
  BREAKDOWN_ACCOUNTS,
  buildBucketedEstimate,
  lineCycleLabel,
  quoteLineNet,
  type EstimateLine,
} from './review-estimate'
import {
  ACCOUNT_TYPE_LABELS,
  allAccounts,
  ASSET_TYPE_LABELS,
  PROOF_CATEGORY_LABELS,
  visibleChapters,
  visibleQuestions,
  type ChapterDef,
  type QuestionDef,
  type WizardAnswers,
} from './registry'

/**
 * The review chapter. J4 (meeting #3, V1-V7, 00:58:28-01:06:58):
 *  - V2: every section is a collapsible disclosure (title + one-line
 *    summary); expanding one auto-collapses the previous so the page reads
 *    in focused pieces, never a wall of text. The first section starts open.
 *  - V1: every section AND every row carries an edit affordance (hover/
 *    focus reveal, always visible on touch) that opens the question's hero
 *    card in the overlay - never a navigation back into the wizard.
 *  - V4/V5/V6/V7: the quote section is the bucketed estimate - recurring
 *    services grouped by the five routine buckets with their math visible,
 *    collapsible per-account breakdowns, direct inline price editing, and
 *    one-time fees listed separately (retro split by period).
 * Never counted in the "Question X of Y" progress.
 */

// ── I3 grouped accounts (plan §1 screen 7 + §3) ───────────────────────────

/** Display order for the review's account groups. J1 (D4): assets before
 *  loans - the count-card order - then anything exotic (legacy/extraction
 *  types) last. */
const REVIEW_ACCOUNT_TYPE_ORDER = [
  'checking',
  'savings',
  'credit_card',
  'vehicle',
  'fixed_assets',
  'investment',
  'other_asset',
  'vehicle_loan',
  'loan',
]

/** The balance-chapter question that edits each account group (V1). */
const ACCOUNT_GROUP_QUESTION: Record<string, string> = {
  checking: 'checking-accounts',
  savings: 'savings-accounts',
  credit_card: 'credit-cards',
  vehicle: 'vehicles',
  fixed_assets: 'other-assets',
  investment: 'other-assets',
  other_asset: 'other-assets',
  vehicle_loan: 'loans',
  loan: 'loans',
}

function accountDetailLine(a: IntakeAccountInput): string | null {
  const parts: string[] = []
  if (a.assetType != null && ASSET_TYPE_LABELS[a.assetType]) parts.push(ASSET_TYPE_LABELS[a.assetType])
  if (a.lender) parts.push(a.lender)
  if (a.year != null) parts.push(String(a.year))
  // J1 (D5): the financed pick shows; "financed" means a linked loan entry
  // already sits in the loans group.
  if (a.financed === 'financed') parts.push('Financed')
  if (a.financed === 'paid') parts.push('Paid in full')
  // Legacy rows only: J1 (D3) removed balance/value capture from intake.
  if (a.balance != null) parts.push(`balance ${formatMoney(a.balance)}`)
  if (a.value != null) parts.push(`value ${formatMoney(a.value)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** V1: the row-level edit affordance - hover/focus reveal on pointer
 *  devices, always visible on touch. K1 (F2, 09_30 01:00:58): bigger, with
 *  a visible border on reveal - "it's kind of small... more interactive". */
function RowEditButton({
  label,
  testid,
  onClick,
}: {
  label: string
  testid: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      data-testid={testid}
      className="shrink-0 self-center rounded-md border border-transparent p-1.5 text-firm-brand-strong opacity-0 transition-all hover:border-firm-brand/40 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

/** I3: accounts grouped by type, each row carrying its institution and
 *  proof-category badges plus the online-access flag.
 *  J1 (D2): the primary text is the bank -> type -> last4 standard
 *  (accountLabel); legacy rows without a last-4 keep the old name and the
 *  institution badge. J4 (V1): every row edits its type's count card. */
function ReviewAccounts({
  answers,
  editable,
  onEdit,
}: {
  answers: WizardAnswers
  editable: boolean
  onEdit: (chapterId: string, questionId: string) => void
}) {
  const accounts = allAccounts(answers)
  if (accounts.length === 0) return null
  const groups = new Map<string, IntakeAccountInput[]>()
  for (const a of accounts) {
    const t = (a.accountType ?? 'other').trim().toLowerCase()
    const list = groups.get(t) ?? []
    list.push(a)
    groups.set(t, list)
  }
  const ordered = [...groups.entries()].sort(([x], [y]) => {
    const ix = REVIEW_ACCOUNT_TYPE_ORDER.indexOf(x)
    const iy = REVIEW_ACCOUNT_TYPE_ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
  })
  return (
    <div className="divide-y divide-border px-4" data-testid="review-accounts">
      {ordered.map(([type, list]) => (
        <div key={type} className="py-2.5" data-testid="review-account-group" data-type={type}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[type] ?? type}
            <span className="tnum ml-1.5">{list.length}</span>
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {list.map((a, i) => {
              const detail = accountDetailLine(a)
              const hasLast4 = normalizeLast4(a.last4) != null
              return (
                <li
                  key={`${a.name}-${i}`}
                  className="group flex flex-wrap items-baseline gap-x-2 gap-y-1"
                  data-testid="review-account-row"
                >
                  <span className="text-sm font-medium text-foreground">{accountLabel(a)}</span>
                  {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                  {a.institution && !hasLast4 && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                      {a.institution}
                    </span>
                  )}
                  {a.fromVehicle != null && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                      Vehicle loan
                    </span>
                  )}
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {PROOF_CATEGORY_LABELS[a.proofCategory ?? ''] ?? 'Statement'}
                  </span>
                  {a.grantLoginAccess === true && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                      Online access
                    </span>
                  )}
                  {editable && (
                    <RowEditButton
                      label={`${ACCOUNT_TYPE_LABELS[type] ?? type} accounts`}
                      testid={`edit-account-row-${type}-${i}`}
                      onClick={() => onEdit('balance', ACCOUNT_GROUP_QUESTION[type] ?? 'checking-accounts')}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** J1 (D5): a loan entry auto-routed from a financed vehicle carries the
 *  fromVehicle marker - rendered as a "Vehicle loan" badge above. */

// ── V4-V7: the bucketed estimate ──────────────────────────────────────────

/** One recurring estimate line: name, math, optional account breakdown, and
 *  the direct price editor (V4). */
function EstimateLineRow({
  view,
  answers,
  cycle,
  priceEditable,
  onPriceChange,
  breakdownOpen,
  onToggleBreakdown,
}: {
  view: EstimateLine
  answers: WizardAnswers
  cycle: number
  priceEditable: boolean
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
  breakdownOpen: boolean
  onToggleBreakdown: () => void
}) {
  const breakdownFor = BREAKDOWN_ACCOUNTS[view.key]
  const breakdownAccounts = breakdownFor ? breakdownFor(answers) : []
  const net = view.cycleNet
  return (
    <li className="group py-2" data-testid={`estimate-line-${view.key}`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 text-sm text-foreground">
          {view.name}
          {view.februaryBilled && (
            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
              billed each February
            </span>
          )}
        </span>
        {priceEditable && onPriceChange ? (
          <PriceEditControl
            serviceKey={view.key}
            name={view.name}
            cycleLabel={lineCycleLabel(view.line, cycle)}
            standard={view.standard}
            effective={net}
            deviates={view.overridden || view.discounted}
            onSave={(dollars) => onPriceChange(view.key, dollars)}
          />
        ) : (
          <StaticPrice standard={view.standard} effective={net} deviates={view.overridden || view.discounted} />
        )}
      </div>
      {view.math && (
        <p className="tnum mt-0.5 text-xs text-muted-foreground" data-testid={`estimate-math-${view.key}`}>
          {view.math}
        </p>
      )}
      {/* V5: the itemized account breakdown (count x rate math sits in the
          line above; the actual accounts list here). */}
      {breakdownFor && breakdownAccounts.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={breakdownOpen}
            aria-controls={`breakdown-${view.key}`}
            data-testid={`breakdown-toggle-${view.key}`}
            onClick={onToggleBreakdown}
            className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', breakdownOpen && 'rotate-180')} aria-hidden />
            {breakdownAccounts.length} account{breakdownAccounts.length === 1 ? '' : 's'}
          </button>
          {breakdownOpen && (
            <ul
              id={`breakdown-${view.key}`}
              data-testid={`breakdown-${view.key}`}
              className="mt-1 space-y-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
            >
              {breakdownAccounts.map((a, i) => (
                <li key={`${a.name}-${i}`} className="text-xs text-foreground" data-testid="breakdown-account">
                  {accountLabel(a)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** The read-only price: standard struck through when the line nets down. */
function StaticPrice({
  standard,
  effective,
  deviates,
}: {
  standard: number | null
  effective: number | null
  deviates: boolean
}) {
  if (effective == null) return <span className="text-xs italic text-muted-foreground">quoted at review</span>
  return (
    <span className="shrink-0">
      {deviates && standard != null && (
        <span className="tnum mr-1.5 text-xs font-normal text-muted-foreground line-through">
          {formatMoney(standard)}
        </span>
      )}
      <span className="tnum text-sm font-medium text-foreground">{formatMoney(effective)}</span>
    </span>
  )
}

function EstimateSection({
  quote,
  answers,
  priceEditable,
  onPriceChange,
}: {
  quote: Quote
  answers: WizardAnswers
  priceEditable: boolean
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
}) {
  const estimate = buildBucketedEstimate(quote, answers)
  // V5: breakdowns toggle independently of the section accordion (V2).
  const [openBreakdowns, setOpenBreakdowns] = useState<Record<string, boolean>>({})

  return (
    <div data-testid="estimate">
      {estimate.groups.length > 0 && (
        <div className="divide-y divide-border px-4" data-testid="estimate-recurring">
          {estimate.groups.map((group) => (
            <div key={group.bucket} className="py-2.5" data-testid={`estimate-bucket-${group.bucket}`}>
              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {ROUTINE_BUCKET_LABELS[group.bucket]}
                <span className="tnum font-normal normal-case tracking-normal" data-testid={`estimate-bucket-total-${group.bucket}`}>
                  {formatMoney(group.perMonth)}/mo
                </span>
              </p>
              <ul className="mt-1 divide-y divide-border/60">
                {group.lines.map((view) => (
                  <EstimateLineRow
                    key={view.key}
                    view={view}
                    answers={answers}
                    cycle={estimate.billingCycle}
                    priceEditable={priceEditable}
                    onPriceChange={onPriceChange}
                    breakdownOpen={openBreakdowns[view.key] === true}
                    onToggleBreakdown={() =>
                      setOpenBreakdowns((o) => ({ ...o, [view.key]: !o[view.key] }))
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {estimate.unpricedRecurringCount > 0 && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {estimate.unpricedRecurringCount} item{estimate.unpricedRecurringCount === 1 ? '' : 's'} priced at
          review, not live
        </p>
      )}

      {/* V7: one-time money, separate from the recurring buckets - QBO
          setup, missed filings, and the retro cleanup split by period. */}
      {estimate.oneTime.length > 0 && (
        <div className="border-t border-border px-4 py-2.5" data-testid="estimate-one-time">
          <p className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            One-time fees
            <span className="tnum font-normal normal-case tracking-normal" data-testid="one-time-total">
              {formatMoney(estimate.oneTimeTotal)}
            </span>
          </p>
          <ul className="mt-1 divide-y divide-border/60">
            {estimate.oneTime.map((item) => (
              <li key={item.key} className="group py-2" data-testid={`one-time-${item.key}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 text-sm text-foreground">{item.name}</span>
                  {priceEditable && onPriceChange ? (
                    <PriceEditControl
                      serviceKey={item.key}
                      name={item.name}
                      cycleLabel="one-time"
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                      onSave={(dollars) => onPriceChange(item.key, dollars)}
                    />
                  ) : (
                    <StaticPrice
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                    />
                  )}
                </div>
                {item.math && (
                  <p className="tnum mt-0.5 text-xs text-muted-foreground" data-testid={`one-time-math-${item.key}`}>
                    {item.math}
                  </p>
                )}
                {item.periods && item.periods.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground" data-testid="retro-periods">
                    {item.periods
                      .map((p) => `${p.label}: ${p.months} month${p.months === 1 ? '' : 's'}`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quote.billingCycle > 1 && (
        <p className="px-4 pb-2.5 text-[11px] text-muted-foreground">
          Billed every {quote.billingCycle} months - shown at the effective monthly rate.
        </p>
      )}
    </div>
  )
}

/** An open section's body: the estimate, running notes, grouped accounts,
 *  or the chapter's answer rows (each with its V1 edit affordance). */
function SectionBody({
  section,
  quote,
  answers,
  editable,
  onEdit,
  onPriceChange,
}: {
  section: SectionDef
  quote: Quote | null
  answers: WizardAnswers
  editable: boolean
  onEdit: (chapterId: string, questionId: string) => void
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
}) {
  if (section.kind === 'quote') {
    if (!quote) return null
    return (
      <EstimateSection
        quote={quote}
        answers={answers}
        priceEditable={editable && onPriceChange != null}
        onPriceChange={onPriceChange}
      />
    )
  }
  if (section.kind === 'notes') {
    /* Running notes captured mid-wizard ride along to the review and, at
        conversion, into the client's notes. */
    return (
      <ul className="divide-y divide-border px-4" data-testid="review-running-notes">
        {(answers.runningNotes ?? []).map((n, i) => (
          <li key={`${n.at}-${i}`} className="py-2.5" data-testid="running-note">
            <p className="text-sm text-foreground">{n.text}</p>
            <p className="tnum mt-0.5 text-[11px] text-muted-foreground">{noteLabel(n.at)}</p>
          </li>
        ))}
      </ul>
    )
  }
  if (section.chapter.id === 'balance') {
    return <ReviewAccounts answers={answers} editable={editable} onEdit={onEdit} />
  }
  return (
    <dl className="divide-y divide-border px-4">
      {section.questions
        .map((q) => ({ q, text: q.summarize(answers) }))
        .filter((r): r is { q: QuestionDef; text: string } => r.text != null)
        .map(({ q, text }) => (
          <div key={q.id} className="group flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-xs text-muted-foreground">{q.title}</dt>
            <dd className="flex items-baseline gap-1.5 text-right text-sm text-foreground">
              <span>{text}</span>
              {editable && (
                <RowEditButton
                  label={q.title}
                  testid={`edit-row-${q.id}`}
                  onClick={() => onEdit(section.chapter.id, q.id)}
                />
              )}
            </dd>
          </div>
        ))}
    </dl>
  )
}

// ── The section model (V2 accordion) ──────────────────────────────────────

type SectionDef =
  | { kind: 'chapter'; id: string; chapter: ChapterDef; questions: QuestionDef[] }
  | { kind: 'quote'; id: 'quote' }
  | { kind: 'notes'; id: 'notes' }

type Phase = 'review' | 'duplicates' | 'submitted'

export function ReviewScreen({
  intakeId,
  answers,
  quote,
  status,
  canConvert,
  managers,
  bookkeepers,
  clientId,
  onEdit,
  onPriceChange,
}: {
  intakeId: number
  answers: WizardAnswers
  quote: Quote | null
  status: 'draft' | 'pending_review' | 'completed' | 'archived'
  canConvert: boolean
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  clientId: number | null
  /** V1: opens the question's hero card in the edit overlay (never navigates). */
  onEdit: (chapterId: string, questionId: string) => void
  /** V4: direct per-line price editing; present only on the editable review. */
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
}) {
  const [phase, setPhase] = useState<Phase>('review')
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [sendingQuote, setSendingQuote] = useState(false)
  // V2: the one-open-at-a-time accordion. Null = untouched (the first
  // section reads open); the '__closed__' sentinel = the user collapsed all.
  const [openSection, setOpenSection] = useState<string | null>(null)

  const editable = status === 'draft'

  // ── The section list, in display order: chapters, then the estimate,
  //    then running notes. ──
  const sections: SectionDef[] = []
  for (const chapter of visibleChapters(answers)) {
    const questions = visibleQuestions(chapter, answers)
    const rows = questions
      .map((q) => ({ q, text: q.summarize(answers) }))
      .filter((r) => r.text != null)
    // I3: the balance chapter's rows all fold into the grouped accounts
    // section; render it whenever accounts exist.
    const isAccountsChapter = chapter.id === 'balance'
    if (rows.length === 0 && !isAccountsChapter) continue
    if (isAccountsChapter && allAccounts(answers).length === 0) continue
    sections.push({ kind: 'chapter', id: chapter.id, chapter, questions })
  }
  if (quote && quote.lines.length > 0) {
    sections.push({ kind: 'quote', id: 'quote' })
  }
  if ((answers.runningNotes ?? []).length > 0) {
    sections.push({ kind: 'notes', id: 'notes' })
  }

  const openId = openSection ?? sections[0]?.id ?? null
  const toggleSection = (id: string) =>
    setOpenSection((cur) => {
      const current = cur ?? sections[0]?.id ?? null
      return current === id ? '__closed__' : id
    })

  /** V2's collapsed one-liner, per section. */
  const summaryFor = (section: SectionDef): string | null => {
    if (section.kind === 'quote') {
      return quote ? `${formatMoney(quote.totals.effectiveMonthly)}/mo effective` : null
    }
    if (section.kind === 'notes') {
      const n = (answers.runningNotes ?? []).length
      return `${n} note${n === 1 ? '' : 's'}`
    }
    if (section.chapter.id === 'balance') {
      const counts = new Map<string, number>()
      for (const a of allAccounts(answers)) {
        const t = (a.accountType ?? 'other').trim().toLowerCase()
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
      return [...counts.entries()]
        .map(([t, n]) => `${n} ${ACCOUNT_TYPE_LABELS[t] ?? t}`)
        .join(' · ')
    }
    const rows = section.questions
      .map((q) => ({ text: q.summarize(answers) }))
      .filter((r): r is { text: string } => r.text != null)
    if (rows.length === 0) return null
    return rows.length > 1 ? `${rows[0].text} · +${rows.length - 1} more` : rows[0].text
  }

  const titleFor = (section: SectionDef): string =>
    section.kind === 'quote' ? 'Estimate' : section.kind === 'notes' ? 'Running notes' : section.chapter.label

  const sendQuote = async () => {
    setSendingQuote(true)
    try {
      const res = await sendIntakeQuoteEmailAction(intakeId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Proposal emailed to ${res.data.to}`)
    } finally {
      setSendingQuote(false)
    }
  }

  const submit = async (force: boolean) => {
    setBusy(true)
    setError(null)
    if (!force) {
      const dup = await checkDuplicates({ legalName: answers.legalName, taxId: answers.taxId })
      if (!dup.ok) {
        setBusy(false)
        setError(dup.error)
        return
      }
      if (dup.data.length > 0) {
        setBusy(false)
        setDuplicates(dup.data)
        setPhase('duplicates')
        return
      }
    }
    const res = await submitIntakeForReview(intakeId)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPhase('submitted')
  }

  if (status === 'completed' && clientId != null) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center" data-testid="converted-state">
        <CheckCircle2 className="mx-auto h-8 w-8 text-status-on-track" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
          This intake is converted
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers stay editable here and cascade to the client record.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/clients/${clientId}`}>
            Open the client
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    )
  }

  if (phase === 'submitted') {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center" data-testid="submitted-success">
        <CheckCircle2 className="mx-auto h-8 w-8 text-status-on-track" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
          Submitted for review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {answers.legalName} is in the review queue. A manager can convert it to a client.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          {canConvert && (
            <Button variant="action" onClick={() => setConvertOpen(true)} data-testid="convert-button">
              Convert to client
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/intake">Back to intakes</Link>
          </Button>
        </div>
        {canConvert && (
          <ConvertDialog
            intakeId={intakeId}
            intakeName={answers.legalName ?? 'this intake'}
            managers={managers}
            bookkeepers={bookkeepers}
            open={convertOpen}
            onOpenChange={setConvertOpen}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="review-screen">
      <div className="space-y-4">
        {sections.map((section) => {
          const open = openId === section.id
          const title = titleFor(section)
          const summary = summaryFor(section)
          const first = section.kind === 'chapter' ? section.questions[0] : undefined
          return (
            <section
              key={section.id}
              className="rounded-xl border border-border bg-card"
              data-chapter={section.kind === 'chapter' ? section.chapter.id : undefined}
              data-testid={section.kind === 'quote' ? 'review-quote' : `review-section-${section.id}`}
            >
              <div
                className={cn(
                  'flex items-center gap-1 px-4 py-2.5',
                  open && 'border-b border-border',
                )}
              >
                {/* V2: the disclosure - keyboard-accessible, one open at a time. */}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`review-panel-${section.id}`}
                  data-testid={`section-toggle-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {title}
                      {section.kind === 'notes' && (
                        <span className="tnum ml-1.5">{(answers.runningNotes ?? []).length}</span>
                      )}
                    </span>
                    {!open && summary && (
                      <span
                        className="mt-0.5 block truncate text-xs normal-case tracking-normal text-muted-foreground"
                        data-testid={`section-summary-${section.id}`}
                      >
                        {summary}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </button>
                <span className="flex shrink-0 items-center gap-2">
                  {section.kind === 'quote' && canConvert && (status === 'draft' || status === 'pending_review') && (
                    /* Correspondence hub: email the proposal to the intake's
                        primary contact (branded template + history row). */
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="email-proposal"
                      disabled={sendingQuote}
                      onClick={() => void sendQuote()}
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {sendingQuote ? 'Sending…' : 'Email proposal'}
                    </Button>
                  )}
                  {section.kind === 'quote' && quote && (
                    <span className="tnum text-sm font-semibold text-money-strong" data-testid="quote-total">
                      {formatMoney(quote.totals.effectiveMonthly)}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">/mo effective</span>
                    </span>
                  )}
                  {section.kind === 'chapter' && editable && first && (
                    <button
                      type="button"
                      onClick={() => onEdit(section.chapter.id, first.id)}
                      data-testid={`edit-${section.chapter.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Edit
                    </button>
                  )}
                </span>
              </div>

              {open && (
                <div id={`review-panel-${section.id}`}>
                  <SectionBody
                    section={section}
                    quote={quote}
                    answers={answers}
                    editable={editable}
                    onEdit={onEdit}
                    onPriceChange={onPriceChange}
                  />
                </div>
              )}
            </section>
          )
        })}
      </div>

      {phase === 'duplicates' && (
        <div
          className="rounded-xl border border-status-due-soon bg-status-due-soon-bg p-4"
          role="alert"
          data-testid="duplicate-warning"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-due-soon" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                Possible duplicate{duplicates.length === 1 ? '' : 's'} found
              </h3>
              <ul className="mt-2 space-y-1">
                {duplicates.map((d) => (
                  <li key={d.id} className="text-sm text-foreground">
                    <span className="font-medium">{d.dbaName ?? d.legalName}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      matches on {d.matchedOn === 'tax_id' ? 'tax ID (EIN)' : 'business name'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={() => submit(true)} disabled={busy} data-testid="submit-anyway">
                  {busy ? 'Submitting…' : 'Submit anyway'}
                </Button>
                <Button variant="outline" onClick={() => setPhase('review')} disabled={busy}>
                  Go back
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      {status === 'draft' && phase === 'review' && (
        <Button variant="action" onClick={() => submit(false)} disabled={busy} data-testid="submit-intake">
          {busy ? 'Checking…' : 'Submit for review'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      )}

      {status === 'pending_review' && (
        <div className="flex items-center gap-3" data-testid="pending-review-actions">
          {canConvert ? (
            <Button variant="action" onClick={() => setConvertOpen(true)} data-testid="convert-button">
              Convert to client
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting on a manager to review and convert.
            </p>
          )}
          <Button asChild variant="outline">
            <Link href="/intake">Back to intakes</Link>
          </Button>
        </div>
      )}

      {canConvert && (
        <ConvertDialog
          intakeId={intakeId}
          intakeName={answers.legalName ?? 'this intake'}
          managers={managers}
          bookkeepers={bookkeepers}
          open={convertOpen}
          onOpenChange={setConvertOpen}
        />
      )}
    </div>
  )
}
