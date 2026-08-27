'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Pencil } from 'lucide-react'
import type { Quote } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { checkDuplicates, submitIntakeForReview } from '@/server/actions/intake'
import type { DuplicateCandidate } from '@/server/intake'
import { monthLabel } from '@/shared/lib/date-display'

import { ConvertDialog, type StaffOption } from './convert-dialog'
import { formatMoney } from './format'
import { quoteLineName } from './quote-panel'
import { findChapter, visibleChapters, visibleQuestions, type WizardAnswers } from './registry'

/**
 * The review chapter: read-only summary grouped by chapter with edit-jump
 * links, a duplicate check before submit, and (for pending_review intakes,
 * manager and above) the convert-to-client action. Never counted in the
 * "Question X of Y" progress.
 */

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

  const chapters = visibleChapters(answers)

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
            <Button onClick={() => setConvertOpen(true)} data-testid="convert-button">
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
          if (rows.length === 0) return null
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
              <dl className="divide-y divide-border px-4">
                {rows.map(({ q, text }) => (
                  <div key={q.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="shrink-0 text-xs text-muted-foreground">{q.title}</dt>
                    <dd className="text-right text-sm text-foreground">{text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}

        {quote && quote.lines.length > 0 && (
          <section className="rounded-xl border border-border bg-card" data-testid="review-quote">
            <header className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quote
              </h3>
              <p className="tnum text-sm font-semibold text-money-positive">
                {formatMoney(quote.totals.effectiveMonthly)}
                <span className="ml-1 text-xs font-medium text-muted-foreground">/mo effective</span>
              </p>
            </header>
            <ul className="divide-y divide-border px-4">
              {quote.lines
                .filter((l) => l.quantity > 0 && !(l.service_key === 'retroactive_bookkeeping' && quote.retroactive))
                .map((l) => (
                  <li key={l.service_key} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="text-sm text-foreground">{quoteLineName(quote, l)}</span>
                    {l.unpriced ? (
                      <span className="text-xs italic text-muted-foreground">quoted at review</span>
                    ) : (
                      <span className="tnum text-sm font-medium text-foreground">
                        {l.amount != null ? formatMoney(l.amount) : ''}
                      </span>
                    )}
                  </li>
                ))}
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
        <Button onClick={() => submit(false)} disabled={busy} data-testid="submit-intake">
          {busy ? 'Checking…' : 'Submit for review'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      )}

      {status === 'pending_review' && (
        <div className="flex items-center gap-3" data-testid="pending-review-actions">
          {canConvert ? (
            <Button onClick={() => setConvertOpen(true)} data-testid="convert-button">
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
