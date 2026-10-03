import {
  QBO_TIER_LABEL,
  isFebruaryBilledService,
  isReconciliationBillableAccount,
  type Month,
  type Quote,
  type QuoteLine,
} from '@firmos/domain'

import type { IntakeAccountInput } from '@/server/intake'
import { statementDayForIntakeAccount } from '@/shared/lib/account-types'
import {
  ROUTINE_BUCKETS,
  isRoutineBucket,
  type RoutineBucket,
  type RoutineSchedule,
} from '@/shared/lib/routine-schedule'

import { formatMoney } from './format'
import { allAccounts, type WizardAnswers } from './registry'

/**
 * J4 (V5/V6/V7, meeting #3 01:02:53-01:06:58): the review screen's bucketed
 * estimate view-model. Pure: a server-computed Quote plus the wizard answers
 * in, display rows out - the UI never prices anything itself.
 *
 *  - V6: recurring lines group into the five routine buckets, reading the
 *    committed form_data.routineSchedule when present (a line's bucket is
 *    its task's bucket; lines with no schedule mapping fall back to their
 *    engine bucket). Every line shows its math normalized to the quote
 *    engine's effective-monthly conventions ($/mo), so the numbers always
 *    reconcile with the totals.
 *  - V7: one-time money (QBO setup, missed filings, the retroactive cleanup
 *    split by period) lists separately - never mixed into recurring, never
 *    double counted.
 *  - V5: the per-account lines carry the accounts their breakdown lists.
 */

// ── Shared line helpers (the panel + review both render these) ────────────

/** Display name for a quote line; the recommended QBO tier is called out. */
export function quoteLineName(quote: Quote, line: QuoteLine): string {
  if (quote.qbo && line.service_key === quote.qbo.serviceKey && quote.qbo.recommended) {
    return `${QBO_TIER_LABEL[quote.qbo.tier]} (recommended)`
  }
  return line.product_name
}

/**
 * A line's net per billing cycle: the direct price override (J4/V4) wins,
 * else the legacy per-cycle discount nets out of the standard amount; both
 * clamp at zero (engine rule). null when the line is unpriced.
 */
export function quoteLineNet(line: QuoteLine): number | null {
  if (line.price_override != null) return Math.max(0, line.price_override)
  if (line.amount == null) return null
  return Math.max(0, line.amount - (line.discount ?? 0))
}

/** The per-line cadence basis for price editing ("per month", "one-time").
 *  Monthly-bucket lines follow the engagement's billing cycle; the periodic
 *  buckets name their own period. */
export function lineCycleLabel(line: QuoteLine, cycle: number): string {
  switch (line.bucket) {
    case 'one_time':
      return 'one-time'
    case 'quarterly':
      return 'per quarter'
    case 'annual':
      return 'per year'
    default:
      if (cycle === 3) return 'per quarter'
      if (cycle === 6) return 'every 6 months'
      if (cycle === 12) return 'per year'
      return 'per month'
  }
}

// ── V5 breakdown accounts ─────────────────────────────────────────────────

/** The accounts the reconciliation line bills for - the server's exact rule
 *  (statement-day-bearing accounts minus loan/merchant types, §6.5), so the
 *  breakdown count always matches the quote's per-account quantity. */
export function reconciliationAccounts(answers: WizardAnswers): IntakeAccountInput[] {
  return allAccounts(answers).filter((a) =>
    isReconciliationBillableAccount({
      account_type: a.accountType,
      statement_day: statementDayForIntakeAccount(a),
    }),
  )
}

const BANK_FEED_TYPES = new Set(['checking', 'savings', 'credit_card'])

/** The money accounts whose feeds the bank-feed line manages. */
export function bankFeedAccounts(answers: WizardAnswers): IntakeAccountInput[] {
  return allAccounts(answers).filter((a) =>
    BANK_FEED_TYPES.has(String(a.accountType ?? '').trim().toLowerCase()),
  )
}

/** Which service keys get an itemized account breakdown, and which list. */
export const BREAKDOWN_ACCOUNTS: Partial<
  Record<string, (answers: WizardAnswers) => IntakeAccountInput[]>
> = {
  bank_feed_management: bankFeedAccounts,
  account_reconciliations: reconciliationAccounts,
}

// ── V6 bucket mapping ─────────────────────────────────────────────────────

/** service_key -> the routine-scheduler task keys that carry its cadence. */
const SERVICE_TASK_KEYS: Record<string, readonly string[]> = {
  bank_feed_management: ['categorize_transactions'],
  account_reconciliations: ['reconcile_accounts'],
  merchant_account_reconciliation: ['merchant-reconciliation'],
  record_bills: ['record-bills'],
  monthly_reporting_5: ['send_reports'],
  monthly_reporting_10: ['send_reports'],
  monthly_reporting_15: ['send_reports'],
  quarterly_reporting: ['send_reports'],
  semi_annual_reporting: ['send_reports'],
  annual_reporting: ['send_reports'],
  '1099_collection': ['1099-collection'],
  '1099_full_management': ['1099-management'],
  '1099_per_filing': ['1099-management', '1099-collection'],
  process_payroll: ['payroll-handling'],
  payroll_quarterly_filings: ['payroll-handling'],
  payroll_state_local_payments: ['payroll-handling'],
  payroll_hours_commission_calculations: ['payroll-handling'],
  payroll_corrections: ['payroll-handling'],
}

function taskKeysFor(line: QuoteLine): string[] {
  const direct = SERVICE_TASK_KEYS[line.service_key]
  if (direct) return [...direct]
  if (/^specialty_report_\d+(_retro)?$/.test(line.service_key)) {
    const name = line.product_name
      .replace(/^Specialty Report: /, '')
      .replace(/^Missed past filings: /, '')
    return [`specialty:${name}`]
  }
  if (line.service_key.startsWith('custom_item_')) return [`custom:${line.product_name}`]
  return []
}

const ENGINE_BUCKET_FALLBACK: Record<string, RoutineBucket> = {
  monthly: 'monthly',
  payroll_monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'annual',
}

/** A recurring line's display bucket: the committed routine schedule wins
 *  (per-service frequencies), the engine's pricing bucket otherwise.
 *  one-time lines have no bucket (V7 separates them). */
export function estimateLineBucket(
  line: QuoteLine,
  schedule: RoutineSchedule | null | undefined,
): RoutineBucket | null {
  if (line.bucket === 'one_time') return null
  if (schedule && Object.keys(schedule).length > 0) {
    for (const key of taskKeysFor(line)) {
      const bucket = schedule[key]?.bucket
      if (isRoutineBucket(bucket)) return bucket
    }
  }
  return ENGINE_BUCKET_FALLBACK[line.bucket] ?? 'monthly'
}

// ── The estimate rows ─────────────────────────────────────────────────────

export interface EstimateLine {
  key: string
  name: string
  line: QuoteLine
  bucket: RoutineBucket
  /** Net per billing cycle (override ?? net of discount), clamped. */
  cycleNet: number | null
  /** The standard per-cycle amount before any override/discount. */
  standard: number | null
  overridden: boolean
  /** A legacy stored discount is netting this line down. */
  discounted: boolean
  unpriced: boolean
  /** February-billed annual (1099s) - outside the effective monthly rate. */
  februaryBilled: boolean
  /** The visible math ("5 accounts × $25 = $125/mo"); null when trivial. */
  math: string | null
  /** The effective-monthly contribution; null when excluded from the rate. */
  perMonth: number | null
}

export interface OneTimeItem {
  key: string
  name: string
  amount: number | null
  standard: number | null
  overridden: boolean
  unpriced: boolean
  /** Retro cleanup: the months x rate math. */
  math: string | null
  /** Retro cleanup split by period (V7): one entry per calendar year. */
  periods: { label: string; months: number }[] | null
}

export interface EstimateBucketGroup {
  bucket: RoutineBucket
  lines: EstimateLine[]
  /** Sum of the group's effective-monthly contributions. */
  perMonth: number
}

export interface BucketedEstimate {
  billingCycle: number
  groups: EstimateBucketGroup[]
  oneTime: OneTimeItem[]
  oneTimeTotal: number
  /** K6 (D7): the retro block at the BOTTOM - the cleanup + missed filings,
   *  never mixed into recurring or the plain one-time fees. */
  retroItems: OneTimeItem[]
  retroTotal: number
  retroDiscountPercent: number | null
  unpricedRecurringCount: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Effective-monthly normalization per the engine's own conventions. */
function perMonthFor(line: QuoteLine, cycleNet: number | null, cycle: number): number | null {
  if (cycleNet == null) return null
  switch (line.bucket) {
    case 'monthly':
    case 'payroll_monthly':
      return round2(cycleNet / cycle)
    case 'quarterly':
      return round2(cycleNet / 3)
    case 'annual':
      return isFebruaryBilledService(line.service_key) ? null : round2(cycleNet / 12)
    default:
      return null
  }
}

/** Months between occurrences for a specialty-report line, derived from its
 *  cycle-normalized quantity (quantity = cycle / period months). */
const CADENCE_BY_MONTHS: Record<number, string> = {
  3: 'quarter',
  6: '6 months',
  12: 'year',
}

/** The visible math for a recurring line - always reconciling with the
 *  engine's own quantity and price. */
function lineMath(
  line: QuoteLine,
  perMonth: number | null,
  cycle: number,
  answers: WizardAnswers,
): string | null {
  if (line.unit_price == null) return null
  // February-billed annuals sit outside the effective monthly rate - the
  // math says so instead of normalizing.
  if (line.bucket === 'annual' && isFebruaryBilledService(line.service_key)) {
    return `${formatMoney(line.unit_price)}/year · billed each February`
  }
  if (perMonth == null) return null
  const rate = formatMoney(line.unit_price)

  // Per-unit monthly (account reconciliations): count x rate = monthly.
  if (line.service_key === 'account_reconciliations') {
    const count = round2(line.quantity / cycle)
    return `${count} account${count === 1 ? '' : 's'} × ${rate} = ${formatMoney(perMonth)}/mo`
  }
  // Custom items carry their own frequency scaling (§15: weekly x4, daily
  // x22) - Jason's example: "$200/week × 4 weeks = $800/mo".
  if (line.service_key.startsWith('custom_item_')) {
    const item = (answers.customItems ?? [])[Number(line.service_key.replace('custom_item_', '')) - 1]
    const base = item?.quantity ?? 1
    const times = base !== 1 ? ` × ${base}` : ''
    if (item?.frequency === 'weekly') {
      return `${rate}/week × 4 weeks${times} = ${formatMoney(perMonth)}/mo`
    }
    if (item?.frequency === 'daily') {
      return `${rate}/day × 22 days${times} = ${formatMoney(perMonth)}/mo`
    }
  }
  // Specialty reports recur on their own cadence.
  const specialty = /^specialty_report_\d+$/.test(line.service_key)
  if (specialty) {
    const months = line.quantity > 0 ? Math.round(cycle / line.quantity) : 1
    const cadence = CADENCE_BY_MONTHS[months]
    if (cadence) return `${rate}/${cadence} ÷ ${months} = ${formatMoney(perMonth)}/mo`
    return `${rate}/mo`
  }
  switch (line.bucket) {
    case 'quarterly':
      return `${rate}/quarter ÷ 3 = ${formatMoney(perMonth)}/mo`
    case 'annual':
      return `${rate}/year ÷ 12 = ${formatMoney(perMonth)}/mo`
    default:
      // Flat monthly services: the price IS the math.
      return null
  }
}

/** The retro cleanup's per-period split (V7): months by calendar year. */
function retroPeriods(startMonth: Month, months: number): { label: string; months: number }[] {
  const out: { label: string; months: number }[] = []
  let year = startMonth.year
  let month = startMonth.month
  let remaining = months
  while (remaining > 0) {
    const inYear = Math.min(remaining, 12 - month + 1)
    out.push({ label: String(year), months: inYear })
    remaining -= inYear
    year += 1
    month = 1
  }
  return out
}

/**
 * Quote + answers -> the bucketed estimate. The priced retroactive line
 * leaves the recurring list (its one-time block owns it - no double
 * counting); zero-quantity lines are noise and drop out.
 */
export function buildBucketedEstimate(quote: Quote, answers: WizardAnswers): BucketedEstimate {
  const cycle = quote.billingCycle
  const schedule = answers.routineSchedule ?? null
  const byBucket = new Map<RoutineBucket, EstimateLine[]>()
  const oneTime: OneTimeItem[] = []
  let unpricedRecurringCount = 0

  for (const line of quote.lines) {
    if (line.quantity <= 0) continue
    const name = quoteLineName(quote, line)
    const net = quoteLineNet(line)
    const overridden = line.price_override != null
    const discounted = !overridden && (line.discount ?? 0) > 0
    const bucket = estimateLineBucket(line, schedule)

    if (bucket == null) {
      // V7: one-time money. The priced retro line is represented by its own
      // period-split block below; the unpriced one lists here, flagged.
      if (line.service_key === 'retroactive_bookkeeping' && quote.retroactive) continue
      // K6 (D7): missed past filings are retro work - they list in the retro
      // block at the bottom, not the one-time fees up top.
      if (/^specialty_report_\d+_retro$/.test(line.service_key)) continue
      oneTime.push({
        key: line.service_key,
        name,
        amount: net,
        standard: line.amount,
        overridden,
        unpriced: line.unpriced && !overridden,
        math: null,
        periods: null,
      })
      continue
    }

    const perMonth = perMonthFor(line, net, cycle)
    if (line.unpriced && !overridden) unpricedRecurringCount += 1
    const view: EstimateLine = {
      key: line.service_key,
      name,
      line,
      bucket,
      cycleNet: net,
      standard: line.amount,
      overridden,
      discounted,
      unpriced: line.unpriced && !overridden,
      februaryBilled: isFebruaryBilledService(line.service_key),
      math: lineMath(line, perMonth, cycle, answers),
      perMonth,
    }
    const list = byBucket.get(bucket) ?? []
    list.push(view)
    byBucket.set(bucket, list)
  }

  // V7: the retroactive cleanup, one-time, split by period (2025 + 2026…).
  // K6 (D7): missed past filings list beside it in the same retro block.
  const retroItems: OneTimeItem[] = []
  const retro = quote.retroactive
  if (retro && retro.months > 0) {
    const retroLine = quote.lines.find((l) => l.service_key === 'retroactive_bookkeeping')
    const overridden = retroLine?.price_override != null
    retroItems.push({
      key: 'retroactive_bookkeeping',
      name: 'Retroactive bookkeeping',
      amount: retro.total,
      standard: retro.baseTotal,
      overridden,
      unpriced: false,
      math: overridden
        ? null
        : `${retro.months} month${retro.months === 1 ? '' : 's'} × ${formatMoney(retro.perMonthRate)}/mo${retro.discountPercent != null ? ` − ${retro.discountPercent}%` : ''}`,
      periods: retroPeriods(retro.startMonth, retro.months),
    })
  }
  for (const line of quote.lines) {
    if (!/^specialty_report_\d+_retro$/.test(line.service_key) || line.quantity <= 0) continue
    retroItems.push({
      key: line.service_key,
      name: quoteLineName(quote, line),
      amount: quoteLineNet(line),
      standard: line.amount,
      overridden: line.price_override != null,
      unpriced: line.unpriced && line.price_override == null,
      math: null,
      periods: null,
    })
  }

  const groups: EstimateBucketGroup[] = ROUTINE_BUCKETS.map((bucket) => {
    const lines = byBucket.get(bucket) ?? []
    return {
      bucket,
      lines,
      perMonth: round2(lines.reduce((acc, l) => acc + (l.perMonth ?? 0), 0)),
    }
  }).filter((g) => g.lines.length > 0)

  return {
    billingCycle: cycle,
    groups,
    oneTime,
    oneTimeTotal: quote.totals.totalOneTime,
    retroItems,
    retroTotal: round2(retroItems.reduce((acc, i) => acc + (i.amount ?? 0), 0)),
    retroDiscountPercent: retro?.discountPercent ?? null,
    unpricedRecurringCount,
  }
}
