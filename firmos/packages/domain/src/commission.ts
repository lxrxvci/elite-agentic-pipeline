/**
 * @firmos/domain - commission and semi-monthly payroll (HANDOFF §6.6, §15).
 *
 * Pure: percentages, tiers, and pay dates are computed from parameters only.
 * Exclusions (cancelled work, waiting-on-client work, catch-up-dated work,
 * paused clients) happen in the caller's row selection; this module owns the
 * ratio, the tiers, and the calendar.
 */

import { addMonths, lastDayOfMonth, parseLocalDate, type LocalDate, type Month } from "./dates.ts";

/**
 * One commission tier: an on-time-percentage floor and the rate it pays.
 * Admin-configurable (owner call notes: "if 99% are done on time they get
 * 45%" must be editable without a code change); the defaults below are the
 * HANDOFF table verbatim.
 */
export interface CommissionTier {
  minOnTimePercent: number;
  rate: number;
}

/**
 * HANDOFF §6.6/§15 tier table, verbatim: on-time % → commission rate.
 * Below 80%, and the no-data case, → 35%.
 */
export const COMMISSION_TIERS: readonly CommissionTier[] = [
  { minOnTimePercent: 100, rate: 50 },
  { minOnTimePercent: 90, rate: 45 },
  { minOnTimePercent: 80, rate: 40 },
  { minOnTimePercent: 0, rate: 35 },
];

/** HANDOFF §6.6: the below-80% and no-data floor rate. */
export const COMMISSION_FLOOR_RATE = 35;

/** Counts used by the on-time ratio; the caller has already excluded
 *  cancelled / waiting-on-client / catch-up-dated / paused-client work. */
export interface OnTimeCounts {
  tasksOnTime: number;
  feedsOnTime: number;
  tasksDue: number;
  feedsDue: number;
}

/**
 * HANDOFF §6.6: on-time % = (tasks on time + feeds on time) /
 * (tasks due + feeds due). Returns null for the no-data case.
 */
export function onTimePercent(c: OnTimeCounts): number | null {
  const due = c.tasksDue + c.feedsDue;
  if (due === 0) return null;
  return ((c.tasksOnTime + c.feedsOnTime) / due) * 100;
}

/**
 * HANDOFF §6.6: the on-time percentage sets the tier; a per-user
 * commission_rate_override bypasses the tiers entirely. `tiers` defaults to
 * the HANDOFF table; admin-configured tables pass their own (anything below
 * the lowest threshold still floors at COMMISSION_FLOOR_RATE). The table is
 * matched highest-threshold-first regardless of the order it is handed in.
 */
export function commissionRate(
  onTimePct: number | null,
  override?: number | null,
  tiers: readonly CommissionTier[] = COMMISSION_TIERS,
  floorRate: number = COMMISSION_FLOOR_RATE,
): number {
  if (override != null) return override;
  if (onTimePct == null) return floorRate;
  const descending = [...tiers].sort((a, b) => b.minOnTimePercent - a.minOnTimePercent);
  for (const tier of descending) {
    if (onTimePct >= tier.minOnTimePercent) return tier.rate;
  }
  return floorRate;
}

export type PayoutConfig = "next_month_first" | "next_month_second" | "same_month_second";

export interface SemiMonthlyPeriod {
  key: "first" | "second";
  start: LocalDate;
  end: LocalDate; // inclusive
  payDate: LocalDate;
}

/**
 * HANDOFF §15: semi-monthly periods run the 1st-15th (paid the 20th by
 * default) and the 16th-end (paid the 5th of the following month by default).
 */
export function semiMonthlyPeriods(year: number, month: number): [SemiMonthlyPeriod, SemiMonthlyPeriod] {
  const next = addMonths({ year, month }, 1);
  return [
    {
      key: "first",
      start: { year, month, day: 1 },
      end: { year, month, day: 15 },
      payDate: { year, month, day: 20 },
    },
    {
      key: "second",
      start: { year, month, day: 16 },
      end: { year, month, day: lastDayOfMonth(year, month) },
      payDate: { year: next.year, month: next.month, day: 5 },
    },
  ];
}

/**
 * HANDOFF §6.6: the per-cadence payout config decides which paycheck a
 * month's commission lands on, named by payroll PERIOD (see
 * semiMonthlyPeriods): next_month_first → the 20th of the next month,
 * next_month_second → the 5th of the month after, same_month_second → the
 * 5th of the next month (paying this month's second period).
 */
export function commissionPayoutDate(config: PayoutConfig, m: Month): LocalDate {
  const next = addMonths(m, 1);
  switch (config) {
    case "same_month_second":
      return { year: next.year, month: next.month, day: 5 };
    case "next_month_first":
      return { year: next.year, month: next.month, day: 20 };
    case "next_month_second": {
      const after = addMonths(m, 2);
      return { year: after.year, month: after.month, day: 5 };
    }
  }
}

/** Duck-typed invoice for commission scoping (HANDOFF §7 Invoice statuses). */
export interface CommissionInvoice {
  status: string;
  sent_at?: string | null;
  paid_at?: string | null;
}

function inMonth(iso: string | null | undefined, m: Month): boolean {
  if (!iso) return false;
  const d = parseLocalDate(iso.slice(0, 10));
  return d.year === m.year && d.month === m.month;
}

/** HANDOFF §6.6: commission applies to invoices sent or paid in the month. */
export function invoiceCountsForCommission(inv: CommissionInvoice, m: Month): boolean {
  if (inv.status !== "sent" && inv.status !== "paid") return false;
  return inMonth(inv.sent_at, m) || inMonth(inv.paid_at, m);
}

/**
 * HANDOFF §15: total pay = hours × base_hourly_pay + commission, where hours
 * are the merged union of workstation and task intervals (see time.ts).
 */
export function totalPay(hours: number, baseHourlyPay: number, commissionAmount: number): number {
  return hours * baseHourlyPay + commissionAmount;
}
