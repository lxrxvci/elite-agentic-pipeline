'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Mail, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { Quote } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { sendIntakeQuoteEmailAction } from '@/server/actions/correspondence'
import { checkDuplicates, submitIntakeForReview } from '@/server/actions/intake'
import type { DuplicateCandidate } from '@/server/intake'
import { monthLabel } from '@/shared/lib/date-display'

import { ConvertDialog, type StaffOption } from './convert-dialog'
import { formatMoney } from './format'
import { noteLabel } from './notes-rail'
import { quoteLineName, quoteLineNet } from './quote-panel'
import {
  ACCOUNT_TYPE_LABELS,
  allAccounts,
  ASSET_TYPE_LABELS,
  findChapter,
  PROOF_CATEGORY_LABELS,
  visibleChapters,
  visibleQuestions,
  type WizardAnswers,
} from './registry'
import type { IntakeAccountInput } from '@/server/intake'

/**
 * The review chapter: read-only summary grouped by chapter with edit-jump
 * links, a duplicate check before submit, and (for pending_review intakes,
 * manager and above) the convert-to-client action. Never counted in the
 * "Question X of Y" progress.
 */

// ── I3 grouped accounts (plan §1 screen 7 + §3) ───────────────────────────

/** Display order for the review's account groups - the count-card order,
 *  then anything exotic (legacy/extraction types) last. */
const REVIEW_ACCOUNT_TYPE_ORDER = [
  'checking',
  'savings',
  'credit_card',
  'loan',
  'vehicle',
  'fixed_assets',
  'investment',
  'other_asset',
]

function accountDetailLine(a: IntakeAccountInput): string | null {
  const parts: string[] = []
  if (a.assetType != null && ASSET_TYPE_LABELS[a.assetType]) parts.push(ASSET_TYPE_LABELS[a.assetType])
  if (a.lender) parts.push(a.lender)
  if (a.year != null) parts.push(String(a.year))
  if (a.balance != null) parts.push(`balance ${formatMoney(a.balance)}`)
  if (a.value != null) parts.push(`value ${formatMoney(a.value)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** I3: accounts grouped by type, each row carrying its institution and
 *  proof-category badges plus the online-access flag. */
function ReviewAccounts({ answers }: { answers: WizardAnswers }) {
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
              return (
                <li key={`${a.name}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="review-account-row">
                  <span className="text-sm font-medium text-foreground">{a.name}</span>
                  {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                  {a.institution && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                      {a.institution}
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
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

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
}: {
  intakeId: number
  answers: WizardAnswers
  quote: Quote | null
  status: 'draft' | 'pending_review' | 'completed' | 'archived'
  canConvert: boolean
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  clientId: number | null
  onEdit: (chapterId: string, questionId: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('review')
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [sendingQuote, setSendingQuote] = useState(false)

  const chapters = visibleChapters(answers)

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
        {chapters.map((chapter) => {
          const questions = visibleQuestions(chapter, answers)
          const rows = questions
            .map((q) => ({ q, text: q.summarize(answers) }))
            .filter((r): r is { q: typeof r.q; text: string } => r.text != null)
          // I3: the balance chapter's rows all fold into the grouped
          // accounts section; render it whenever accounts exist.
          const isAccountsChapter = chapter.id === 'balance'
          if (rows.length === 0 && !isAccountsChapter) return null
          if (isAccountsChapter && allAccounts(answers).length === 0) return null
          const first = questions[0]
          return (
            <section key={chapter.id} className="rounded-xl border border-border bg-card" data-chapter={chapter.id}>
              <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {chapter.label}
                </h3>
                {status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => onEdit(chapter.id, first.id)}
                    data-testid={`edit-${chapter.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    Edit
                  </button>
                )}
              </header>
              {isAccountsChapter ? (
                <ReviewAccounts answers={answers} />
              ) : (
                <dl className="divide-y divide-border px-4">
                  {rows.map(({ q, text }) => (
                    <div key={q.id} className="flex items-baseline justify-between gap-4 py-2.5">
                      <dt className="shrink-0 text-xs text-muted-foreground">{q.title}</dt>
                      <dd className="text-right text-sm text-foreground">{text}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          )
        })}

        {quote && quote.lines.length > 0 && (
          <section className="rounded-xl border border-border bg-card" data-testid="review-quote">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quote
              </h3>
              <div className="flex items-center gap-3">
                {/* Correspondence hub: email the proposal to the intake's
                    primary contact (branded template + history row). */}
                {canConvert && (status === 'draft' || status === 'pending_review') && (
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
                <p className="tnum text-sm font-semibold text-money-positive">
                  {formatMoney(quote.totals.effectiveMonthly)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">/mo effective</span>
                </p>
              </div>
            </header>
            <ul className="divide-y divide-border px-4">
              {quote.lines
                .filter((l) => l.quantity > 0 && !(l.service_key === 'retroactive_bookkeeping' && quote.retroactive))
                .map((l) => {
                  const discount = l.discount ?? 0
                  const net = quoteLineNet(l)
                  return (
                    <li key={l.service_key} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="text-sm text-foreground">
                        {quoteLineName(quote, l)}
                        {discount > 0 && (
                          <span
                            className="tnum ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground"
                            data-testid={`review-discount-${l.service_key}`}
                          >
                            −{formatMoney(discount)}/cycle
                          </span>
                        )}
                      </span>
                      {l.unpriced ? (
                        <span className="text-xs italic text-muted-foreground">quoted at review</span>
                      ) : (
                        <span className="tnum text-sm font-medium text-foreground">
                          {discount > 0 && l.amount != null && (
                            <span className="mr-1.5 text-xs font-normal text-muted-foreground line-through">
                              {formatMoney(l.amount)}
                            </span>
                          )}
                          {net != null ? formatMoney(net) : ''}
                        </span>
                      )}
                    </li>
                  )
                })}
            </ul>
          </section>
        )}

        {quote?.retroactive && quote.retroactive.months > 0 && (
          <section className="rounded-xl border border-border bg-card" data-testid="review-retroactive">
            <header className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Retroactive bookkeeping
              </h3>
              <p className="tnum text-sm font-semibold text-foreground">
                {formatMoney(quote.retroactive.total)}
                <span className="ml-1 text-xs font-medium text-muted-foreground">one-time</span>
              </p>
            </header>
            <div className="px-4 py-2.5">
              <p className="text-sm text-foreground">
                <span className="tnum">{quote.retroactive.months}</span> monthly line
                item{quote.retroactive.months === 1 ? '' : 's'}, from{' '}
                {monthLabel(quote.retroactive.startMonth.year, quote.retroactive.startMonth.month)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Billed per month at the quote&apos;s effective monthly rate of{' '}
                <span className="tnum">{formatMoney(quote.retroactive.perMonthRate)}</span>
              </p>
            </div>
          </section>
        )}

        {/* Running notes captured mid-wizard ride along to the review and,
            at conversion, into the client's notes. */}
        {(answers.runningNotes ?? []).length > 0 && (
          <section className="rounded-xl border border-border bg-card" data-testid="review-running-notes">
            <header className="border-b border-border px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Running notes
                <span className="tnum ml-1.5">{(answers.runningNotes ?? []).length}</span>
              </h3>
            </header>
            <ul className="divide-y divide-border px-4">
              {(answers.runningNotes ?? []).map((n, i) => (
                <li key={`${n.at}-${i}`} className="py-2.5" data-testid="running-note">
                  <p className="text-sm text-foreground">{n.text}</p>
                  <p className="tnum mt-0.5 text-[11px] text-muted-foreground">{noteLabel(n.at)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
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
