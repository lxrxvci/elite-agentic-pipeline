import { moneyLabel } from '@/components/clients/format'
import { monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import type { InvoiceListRow } from './view-model'

/**
 * The money hero row for /invoices: three glanceable totals computed from
 * the viewed month's rows. Money means money here - the figures use the
 * money accents (danger for overdue) and tabular numerals, with the count
 * captions carrying the text label so color is never the only signal.
 */

export interface InvoiceHeroTotals {
  /** Sent + overdue totals (the money still to collect), cents. */
  outstandingCents: number
  /** Overdue totals only, cents. */
  overdueCents: number
  /** All non-void totals (everything billed this month), cents. */
  billedCents: number
  openCount: number
  overdueCount: number
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
  const billed = rows.filter((r) => r.status !== 'void')
  return {
    outstandingCents: open.reduce((sum, r) => sum + cents(r), 0),
    overdueCents: overdue.reduce((sum, r) => sum + cents(r), 0),
    billedCents: billed.reduce((sum, r) => sum + cents(r), 0),
    openCount: open.length,
    overdueCount: overdue.length,
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
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid={testId}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'tnum mt-1 font-display text-2xl font-bold tracking-tight',
          figureClass,
        )}
      >
        {moneyLabel((cents / 100).toFixed(2))}
      </p>
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
    <div className="grid gap-3 sm:grid-cols-3" data-testid="invoices-hero">
      <HeroCard
        label="Outstanding"
        cents={totals.outstandingCents}
        caption={`${plural(totals.openCount, 'open invoice')} to collect`}
        figureClass="text-money-strong"
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
        figureClass={hasOverdue ? 'text-status-overdue' : 'text-foreground'}
        testId="hero-overdue"
      />
      <HeroCard
        label="Billed this month"
        cents={totals.billedCents}
        caption={`${plural(totals.billedCount, 'invoice')} in ${monthLabel(year, month)}`}
        figureClass="text-money-strong"
        testId="hero-billed"
      />
    </div>
  )
}
