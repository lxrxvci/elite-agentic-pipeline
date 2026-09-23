import { moneyLabel } from '@/components/clients/format'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import type { InvoiceListRow } from './view-model'

/**
 * The money hero row for /invoices (DESIGN-FRESHBOOKS §1 hero stats): four
 * glanceable totals computed from the viewed month's rows - Outstanding,
 * Overdue, Draft, and Paid. Huge tabular numerals in the brand-strong blue
 * (AA on white); overdue takes the danger accent only when it is nonzero and
 * zeros stay muted so an empty bucket never shouts. Count captions carry the
 * text label so color is never the only signal.
 */

export interface InvoiceHeroTotals {
  /** Sent + overdue totals (the money still to collect), cents. */
  outstandingCents: number
  /** Overdue totals only, cents. */
  overdueCents: number
  /** Draft totals (not yet sent), cents. */
  draftCents: number
  /** Paid totals for the viewed month, cents. */
  paidCents: number
  /** All non-void totals (everything billed this month), cents. */
  billedCents: number
  openCount: number
  overdueCount: number
  draftCount: number
  paidCount: number
  billedCount: number
}

/**
 * Totals are numeric strings from Postgres; they are summed as cents
 * integers so display rounding never compounds.
 */
export function invoiceHeroTotals(rows: InvoiceListRow[]): InvoiceHeroTotals {
  const cents = (r: InvoiceListRow) => Math.round(Number(r.total) * 100)
  const open = rows.filter((r) => r.status === 'sent' || r.status === 'overdue')
  const overdue = rows.filter((r) => r.status === 'overdue')
  const draft = rows.filter((r) => r.status === 'draft')
  const paid = rows.filter((r) => r.status === 'paid')
  const billed = rows.filter((r) => r.status !== 'void')
  return {
    outstandingCents: open.reduce((sum, r) => sum + cents(r), 0),
    overdueCents: overdue.reduce((sum, r) => sum + cents(r), 0),
    draftCents: draft.reduce((sum, r) => sum + cents(r), 0),
    paidCents: paid.reduce((sum, r) => sum + cents(r), 0),
    billedCents: billed.reduce((sum, r) => sum + cents(r), 0),
    openCount: open.length,
    overdueCount: overdue.length,
    draftCount: draft.length,
    paidCount: paid.length,
    billedCount: billed.length,
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function HeroCard({
  label,
  cents,
  caption,
  figureClass,
  testId,
}: {
  label: string
  cents: number
  caption: string
  figureClass: string
  testId: string
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card px-4 py-3 shadow-card"
      data-testid={testId}
    >
      <p
        className={cn(
          'tnum font-display text-[32px] font-bold leading-none tracking-tight',
          figureClass,
        )}
      >
        {moneyLabel((cents / 100).toFixed(2))}
      </p>
      <p className="mt-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>
    </div>
  )
}

export function InvoicesHero({
  rows,
  year,
  month,
}: {
  rows: InvoiceListRow[]
  year: number
  month: number
}) {
  const totals = invoiceHeroTotals(rows)
  const hasOverdue = totals.overdueCents > 0
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="invoices-hero">
      <HeroCard
        label="Outstanding"
        cents={totals.outstandingCents}
        caption={`${plural(totals.openCount, 'open invoice')} to collect`}
        figureClass={totals.outstandingCents > 0 ? 'text-firm-brand-strong' : 'text-muted-foreground'}
        testId="hero-outstanding"
      />
      <HeroCard
        label="Overdue"
        cents={totals.overdueCents}
        caption={
          hasOverdue
            ? `${plural(totals.overdueCount, 'invoice')} past due`
            : 'Nothing past due'
        }
        figureClass={hasOverdue ? 'text-status-overdue' : 'text-muted-foreground'}
        testId="hero-overdue"
      />
      <HeroCard
        label="In draft"
        cents={totals.draftCents}
        caption={`${plural(totals.draftCount, 'draft')} not yet sent`}
        figureClass={totals.draftCents > 0 ? 'text-firm-brand-strong' : 'text-muted-foreground'}
        testId="hero-draft"
      />
      <HeroCard
        label="Paid this month"
        cents={totals.paidCents}
        caption={`${plural(totals.paidCount, 'invoice')} paid in ${monthLabel(year, month)}`}
        figureClass={totals.paidCents > 0 ? 'text-firm-brand-strong' : 'text-muted-foreground'}
        testId="hero-paid"
      />
    </div>
  )
}
