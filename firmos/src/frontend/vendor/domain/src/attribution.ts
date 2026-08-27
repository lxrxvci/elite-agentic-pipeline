/**
 * @firmos/domain - attribution: which accounting month does this belong to?
 *
 * Pure port of yb-backend/app/attribution.py (HANDOFF §6.1). There are TWO
 * independent rules and confusing them is a classic mistake:
 *   RULE 1 (statement rule): a bank statement is dated X → which month's books?
 *   RULE 2 (work-item rule): a task is due on date X → which month's work?
 *
 * Nothing outside this module is permitted to re-implement these rules
 * (HANDOFF §30 convention 1). Duck-typed inputs only - no DB, no ORM.
 */

import {
  addMonths,
  lastDayOfMonth,
  parseLocalDate,
  type LocalDate,
  type Month,
} from "./dates.ts";

export type { Month };
export type CloseTier = 5 | 10 | 15;

/** HANDOFF §6.1 RULE 1 (attribution.py:57). */
export const DEFAULT_ATTRIBUTION_CUTOFF_DAY = 15;

/** HANDOFF §6.1 RULE 2 (attribution.py:220). */
export const WORK_PERIOD_CUTOFF_DAY = 20;

/** HANDOFF §6.1 RULE 2 (attribution.py:224): cadences that always attribute backwards. */
export const PRIOR_PERIOD_SCHEDULES: ReadonlySet<string> = new Set([
  "quarterly",
  "semi_annual",
  "annual",
]);

/** attribution.py:38 - the month immediately before. */
export function priorMonth(year: number, month: number): Month {
  return addMonths({ year, month }, -1);
}

/** attribution.py:43 - the month immediately after. */
export function followingMonth(year: number, month: number): Month {
  return addMonths({ year, month }, 1);
}

/**
 * HANDOFF §32 ("Close tier"): a monthly client's promised delivery day - the
 * 5th, 10th, or 15th of the FOLLOWING month. This is the due date for an
 * accounting month's work.
 */
export function closeTierDueDate(m: Month, tier: CloseTier): LocalDate {
  const next = followingMonth(m.year, m.month);
  return {
    year: next.year,
    month: next.month,
    day: Math.min(tier, lastDayOfMonth(next.year, next.month)),
  };
}

/** Duck-typed client cadence/close-tier fields (HANDOFF §7 Client field groups). */
export interface CadenceSource {
  bookkeeping_frequency?: string | null;
  monthly_close_tier?: number | null;
}

/**
 * attribution.py:60 - HANDOFF §6.1 RULE 1: only MONTHLY clients have a tier
 * cutoff (5, 10, or 15). Quarterly, semi-annual, and annual clients return
 * null and fall back to the default 15.
 */
export function tierDayForClient(client: CadenceSource): CloseTier | null {
  if (client.bookkeeping_frequency !== "monthly") return null;
  const t = client.monthly_close_tier;
  return t === 5 || t === 10 || t === 15 ? t : null;
}

/** Effective cutoff day: the client's tier day, defaulting to the 15th. */
export function attributionCutoff(tierDay: CloseTier | null | undefined): number {
  return tierDay ?? DEFAULT_ATTRIBUTION_CUTOFF_DAY;
}

/**
 * attribution.py:78 - when the statement covering an accounting month is
 * issued. Must remain the EXACT INVERSE of attributedPeriodForDate
 * (HANDOFF §6.1 invariant): uploads that don't round-trip vanish from the grid.
 *
 * - End-of-month accounts (statement_day None/0/≥ last day of the month) are
 *   dated the last day of the accounting month itself.
 * - A mid-month statement_day at/after the cutoff covers its own calendar
 *   month, so it is issued on that day OF the accounting month.
 * - A mid-month statement_day before the cutoff covers the prior month, so it
 *   is issued on that day of the FOLLOWING month.
 */
export function statementReleaseDate(
  statementDay: number | null | undefined,
  year: number,
  month: number,
  tierDay: CloseTier | null | undefined,
): LocalDate {
  const last = lastDayOfMonth(year, month);
  if (!statementDay || statementDay >= last) return { year, month, day: last };
  const cutoff = attributionCutoff(tierDay);
  if (statementDay >= cutoff) return { year, month, day: statementDay };
  const next = followingMonth(year, month);
  return { year: next.year, month: next.month, day: statementDay };
}

/**
 * attribution.py:107 - RULE 1: statement date → accounting month.
 * - statement_day None/0, or an end-of-month account, or a statement dated
 *   on/after the last day of its month → the statement's own calendar month
 *   (grid uploads default to month-end, so this makes them round-trip).
 * - Mid-month, dated on/after the cutoff → own month ("before" is strict).
 * - Mid-month, dated before the cutoff → the previous month.
 */
export function attributedPeriodForDate(
  statementDay: number | null | undefined,
  stmtDate: LocalDate,
  tierDay: CloseTier | null | undefined,
): Month {
  const own: Month = { year: stmtDate.year, month: stmtDate.month };
  const last = lastDayOfMonth(stmtDate.year, stmtDate.month);
  if (!statementDay) return own;
  if (statementDay >= last) return own;
  if (stmtDate.day >= last) return own;
  if (stmtDate.day >= attributionCutoff(tierDay)) return own;
  return priorMonth(stmtDate.year, stmtDate.month);
}

/**
 * attribution.py:143 - what every upload path must call (HANDOFF §30
 * convention 8). Honors an explicit period ONLY for the genuinely ambiguous
 * month-end case; for any non-month-end statement date the derived period
 * wins (HANDOFF §29: an explicitly clicked grid cell's period is discarded
 * for any non-month-end statement date).
 */
export function resolveAttributedPeriod(
  statementDay: number | null | undefined,
  statementDate: LocalDate,
  tierDay: CloseTier | null | undefined,
  explicitYear?: number | null,
  explicitMonth?: number | null,
): Month {
  const last = lastDayOfMonth(statementDate.year, statementDate.month);
  if (explicitYear && explicitMonth && statementDate.day >= last) {
    return { year: explicitYear, month: explicitMonth };
  }
  return attributedPeriodForDate(statementDay, statementDate, tierDay);
}

/**
 * attribution.py:178 - walks forward from the required start to the first
 * accounting month whose statement has not been uploaded, returning that
 * month and its release date. The walk itself is date-independent; `today`
 * is accepted for parity with the Python signature and for callers that
 * bucket the result (overdue ⇔ releaseDate is in the past, HANDOFF §6.7).
 */
export function nextUpcomingStatement(
  statementDay: number | null | undefined,
  haveMonths: readonly Month[],
  today: LocalDate,
  tierDay: CloseTier | null | undefined,
  requiredStart: Month,
  maxMonths = 240,
): { year: number; month: number; releaseDate: LocalDate } | null {
  void today;
  let cursor: Month = { year: requiredStart.year, month: requiredStart.month };
  for (let i = 0; i < maxMonths; i++) {
    const have = haveMonths.some((h) => h.year === cursor.year && h.month === cursor.month);
    if (!have) {
      return {
        year: cursor.year,
        month: cursor.month,
        releaseDate: statementReleaseDate(statementDay, cursor.year, cursor.month, tierDay),
      };
    }
    cursor = followingMonth(cursor.year, cursor.month);
  }
  return null;
}

/** attribution.py:227 - a report task's name starts with "prepare " or contains "send report". */
export function isReportTaskName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.startsWith("prepare ") || n.includes("send report");
}

/**
 * attribution.py:237 - RULE 2, the plain day-of-month rule:
 * due on/before the 20th → the prior month (March's books are due early
 * April); due after the 20th → the month it falls in.
 */
export function workPeriodForDue(due: LocalDate): Month {
  if (due.day <= WORK_PERIOD_CUTOFF_DAY) return priorMonth(due.year, due.month);
  return { year: due.year, month: due.month };
}

/**
 * attribution.py:244 - RULE 2 with the two backwards exceptions:
 * report tasks always attribute backwards regardless of due date, and
 * quarterly/semi-annual/annual cadences always attribute backwards (they
 * commonly land on the 30th/31st, where the plain rule would wrongly claim
 * the due month).
 */
export function workPeriodForTask(
  due: LocalDate,
  opts: { name?: string | null; scheduleType?: string | null } = {},
): Month {
  if (opts.name && isReportTaskName(opts.name)) return priorMonth(due.year, due.month);
  if (opts.scheduleType && PRIOR_PERIOD_SCHEDULES.has(opts.scheduleType)) {
    return priorMonth(due.year, due.month);
  }
  return workPeriodForDue(due);
}

/** Duck-typed RecurringTask shape. */
export interface RuleSource {
  name?: string | null;
  title?: string | null;
  schedule_type?: string | null;
}

/** attribution.py:264 - wrapper for a recurring rule. */
export function workPeriodForRule(rule: RuleSource, due: LocalDate): Month {
  return workPeriodForTask(due, {
    name: rule.title ?? rule.name,
    scheduleType: rule.schedule_type,
  });
}

/** Duck-typed persisted work row (task, feed, reconciliation, or report). */
export interface RowSource extends RuleSource {
  attributed_year?: number | null;
  attributed_month?: number | null;
  due_date?: string | LocalDate | null;
}

/**
 * attribution.py:273 - reads a persisted row: stored attributed_year/
 * attributed_month ALWAYS wins over derivation. Catch-up rows generated in
 * one batch share a single due date; deriving would collapse them all into
 * the same month (HANDOFF §6.1).
 */
export function workPeriodForRow(row: RowSource): Month {
  if (row.attributed_year && row.attributed_month) {
    return { year: row.attributed_year, month: row.attributed_month };
  }
  if (!row.due_date) throw new Error("workPeriodForRow: row has no attributed period and no due_date");
  const due = typeof row.due_date === "string" ? parseLocalDate(row.due_date) : row.due_date;
  return workPeriodForTask(due, { name: row.title ?? row.name, scheduleType: row.schedule_type });
}
