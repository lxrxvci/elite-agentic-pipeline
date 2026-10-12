import { weekdayOccurrencesInMonth } from './routine-schedule'

/**
 * M3 (10_10, the pricing engine core): Jason's per-line billing model -
 * "Billing frequency is different than frequency" (01:03:54). Every
 * estimate line carries two independent frequencies:
 *
 *  - CALCULATION frequency: how the unit price is measured ("$25 per week
 *    counting Fridays", "$300 flat a month", "$225 a year"). Defaults to
 *    the line's natural cadence (01:01:27: "It'll default to the type that
 *    it is").
 *  - BILLING frequency: how often the client is invoiced for it (weekly /
 *    monthly / quarterly / annual). Defaults to the book-closing frequency
 *    (00:57:44); annual lines bill annually in their month (L4/G9).
 *
 * Averaging is REJECTED as a default (01:09:53): amounts are actual
 * counts per period, never smoothed.
 */

export type CalcFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
export type BillingFrequency = 'weekly' | 'monthly' | 'quarterly' | 'annual'

export interface LineBillingConfig {
  calcFrequency: CalcFrequency
  billingFrequency: BillingFrequency
  /** daily/weekly calc: the weekdays that count (weekly = one, daily = any). */
  calcWeekdays?: number[]
  /** monthly billing: the day of the month it bills on (01:11:53). */
  billDay?: number | null
  /** annual billing: the month it bills in (L4/G9). */
  billMonth?: number | null
  /** A weekly-scheduled line calculated as a flat monthly amount -
   *  "we're just going to have a flat monthly fee for that weekly task"
   *  (01:00:03); the unit becomes "month" (01:02:14). */
  flatMonthly?: boolean
  /** M4 (10_10, 01:12:43): "normal billing frequency or its own invoice" -
   *  flagged lines bill on their own invoice row, never bundled with the
   *  engagement's regular invoice (uniform across every billing scenario). */
  ownInvoice?: boolean
}

/** Per-line overrides from form_data.lineBilling (service key → partial). */
export type LineBillingOverrides = Record<string, Partial<LineBillingConfig>>

export const CALC_FREQUENCIES: readonly CalcFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'annual']
export const BILLING_FREQUENCIES: readonly BillingFrequency[] = ['weekly', 'monthly', 'quarterly', 'annual']

export const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  quarterly: 'quarter',
  annual: 'year',
}

const VALID_CALC: ReadonlySet<string> = new Set(CALC_FREQUENCIES)
const VALID_BILL: ReadonlySet<string> = new Set(BILLING_FREQUENCIES)

/**
 * The default config for a line (A10/A13): calc follows the line's natural
 * cadence; billing follows the book-closing frequency, except annual lines,
 * which bill annually in their assigned month (L4's bill_month preserved).
 */
export function defaultLineBilling(input: {
  /** The line's display bucket (schedule wins over the engine bucket). */
  bucket: string
  /** The schedule's weekdays for weekly-scheduled lines (calcWeekdays default). */
  scheduleWeekdays?: number[] | null
  /** The engagement's book-closing frequency (answers.bookkeepingFrequency). */
  closingFrequency: string
  /** An explicit L4 billing-month assignment, preserved when present. */
  billMonth?: number | null
}): LineBillingConfig {
  const closing = VALID_BILL.has(input.closingFrequency)
    ? (input.closingFrequency as BillingFrequency)
    : 'monthly'
  if (input.bucket === 'annual') {
    return {
      calcFrequency: 'annual',
      billingFrequency: 'annual',
      billMonth: input.billMonth ?? null,
    }
  }
  if (input.bucket === 'quarterly') {
    return { calcFrequency: 'quarterly', billingFrequency: closing }
  }
  if (input.bucket === 'weekly') {
    return {
      calcFrequency: 'weekly',
      billingFrequency: closing,
      calcWeekdays: input.scheduleWeekdays ?? [5],
    }
  }
  if (input.bucket === 'daily') {
    return {
      calcFrequency: 'daily',
      billingFrequency: closing,
      calcWeekdays: input.scheduleWeekdays ?? [1, 2, 3, 4, 5],
    }
  }
  return { calcFrequency: 'monthly', billingFrequency: closing }
}

/** Resolve the effective config: overrides win field-by-field over defaults. */
export function resolveLineBilling(
  defaults: LineBillingConfig,
  override: Partial<LineBillingConfig> | null | undefined,
): LineBillingConfig {
  if (!override) return defaults
  const calcFrequency =
    override.calcFrequency != null && VALID_CALC.has(override.calcFrequency)
      ? override.calcFrequency
      : defaults.calcFrequency
  const billingFrequency =
    override.billingFrequency != null && VALID_BILL.has(override.billingFrequency)
      ? override.billingFrequency
      : defaults.billingFrequency
  return {
    calcFrequency,
    billingFrequency,
    calcWeekdays: override.calcWeekdays ?? defaults.calcWeekdays,
    billDay: override.billDay !== undefined ? override.billDay : (defaults.billDay ?? null),
    billMonth: override.billMonth !== undefined ? override.billMonth : (defaults.billMonth ?? null),
    flatMonthly: override.flatMonthly ?? (calcFrequency === 'monthly' && defaults.calcFrequency === 'weekly' ? true : defaults.flatMonthly),
    ownInvoice: override.ownInvoice ?? defaults.ownInvoice,
  }
}

// ── Amounts ───────────────────────────────────────────────────────────────

/** Whole months in a period for the prorate rules. */
const MONTHS_PER: Record<'monthly' | 'quarterly' | 'annual', number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

function monthsOfPeriod(
  period: BillingFrequency,
  anchor: { year: number; month: number },
): { year: number; month: number }[] {
  const count = MONTHS_PER[period as 'monthly' | 'quarterly' | 'annual'] ?? 1
  const out: { year: number; month: number }[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(anchor.year, anchor.month - 1 + i, 1)
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  return out
}

/**
 * The line's amount at ITS CALCULATION cadence for the estimate month -
 * what the estimate line displays ("5 Fridays × $25 = $125 Oct"). The
 * estimate month is explicit (never amortized into a fake monthly figure).
 */
export function calcAmountForMonth(
  cfg: LineBillingConfig,
  unitPrice: number,
  quantity: number,
  year: number,
  month: number,
): number {
  const base = unitPrice * quantity
  if (cfg.flatMonthly) return base
  switch (cfg.calcFrequency) {
    case 'monthly':
      return base
    case 'quarterly':
      return base
    case 'annual':
      return base
    case 'weekly':
      return base * weekdayOccurrencesInMonth(year, month, cfg.calcWeekdays ?? [5])
    case 'daily':
      return base * weekdayOccurrencesInMonth(year, month, cfg.calcWeekdays ?? [1, 2, 3, 4, 5])
  }
}

/**
 * The amount billed at a given BILLING period, prorated by Jason's
 * cross-frequency rules (01:04:37): weekly-calc counts weekday occurrences
 * over the period; monthly-calc counts months; annual-calc divides; an
 * annual bill lands the full calc-annual amount in its month.
 */
export function billingAmountForPeriod(
  cfg: LineBillingConfig,
  unitPrice: number,
  quantity: number,
  period: BillingFrequency,
  anchor: { year: number; month: number; weekOccurrences?: number },
): number {
  if (cfg.flatMonthly) {
    // Flat monthly: a per-month amount prorated like monthly-calc.
    return prorateMonthlyAmount(unitPrice * quantity, period, cfg)
  }
  switch (cfg.calcFrequency) {
    case 'monthly':
      return prorateMonthlyAmount(unitPrice * quantity, period, cfg)
    case 'quarterly':
      return prorateMonthlyAmount((unitPrice * quantity) / 3, period, cfg)
    case 'annual':
      return prorateMonthlyAmount((unitPrice * quantity) / 12, period, cfg)
    case 'weekly':
    case 'daily': {
      const base = unitPrice * quantity
      if (period === 'weekly') {
        // Per week: each selected weekday bills once ("charge your card
        // every week, calculated on a weekly basis", 00:59:22).
        return base * (cfg.calcWeekdays ?? [5]).length
      }
      // The whole window: actual weekday occurrences in every month of the
      // period (never a smoothed average, 01:09:53).
      return monthsOfPeriod(period, anchor).reduce(
        (total, m) => total + base * weekdayOccurrencesInMonth(m.year, m.month, cfg.calcWeekdays ?? [5]),
        0,
      )
    }
  }
}

/** Monthly-calc-family proration (monthly/quarterly/annual calc lines and
 *  flat-monthly): month ×1, quarter ×3, year ×12, week ×12/52. */
function prorateMonthlyAmount(
  monthlyAmount: number,
  period: BillingFrequency,
  _cfg: LineBillingConfig,
): number {
  switch (period) {
    case 'weekly':
      return (monthlyAmount * 12) / 52
    case 'monthly':
      return monthlyAmount
    case 'quarterly':
      return monthlyAmount * 3
    case 'annual':
      return monthlyAmount * 12
  }
}

/** The per-month occurrence label for the line's math string
 *  ("5 Fridays × $25 = $125" / "13 weekdays × $25 = $325"). */
export function occurrenceMathLabel(
  cfg: LineBillingConfig,
  unitPrice: number,
  year: number,
  month: number,
  weekdayName: (d: number) => string,
  money: (n: number) => string,
): string | null {
  if (cfg.flatMonthly) return null
  if (cfg.calcFrequency === 'weekly') {
    const days = cfg.calcWeekdays ?? [5]
    const count = weekdayOccurrencesInMonth(year, month, days)
    const dayName = days.length === 1 ? `${weekdayName(days[0]!)}s` : `${days.length} weekdays`
    return `${count} ${dayName} × ${money(unitPrice)}`
  }
  if (cfg.calcFrequency === 'daily') {
    const days = cfg.calcWeekdays ?? [1, 2, 3, 4, 5]
    const count = weekdayOccurrencesInMonth(year, month, days)
    return `${count} days × ${money(unitPrice)}`
  }
  return null
}

/** Rounded cents everywhere money aggregates (the engine's convention). */
export const round2 = (n: number): number => Math.round(n * 100) / 100
