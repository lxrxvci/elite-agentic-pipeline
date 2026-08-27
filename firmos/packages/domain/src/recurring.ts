/**
 * @firmos/domain - recurring rule scheduling (HANDOFF §6.4, recurring_utils.py).
 *
 * Pure date math over duck-typed RecurringTask rows. Calendar days are
 * firm-local {year, month, day} values; `next_run` may be passed as an
 * ISO-local string or a LocalDate. No clock access anywhere.
 */

import {
  addDays,
  addMonths,
  compareLocalDate,
  dayOfWeek,
  formatLocalDate,
  lastDayOfMonth,
  parseLocalDate,
  type LocalDate,
  type Month,
} from "./dates.ts";

export type ScheduleType =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual";

/** Duck-typed RecurringTask (HANDOFF §6.4 supporting fields). */
export interface RecurringRuleShape {
  schedule_type: ScheduleType | string;
  /** comma-separated, 0 = Sunday */
  days_of_week?: string | null;
  day_of_month?: number | null;
  /** 0 = Sunday; paired with week_of_month */
  weekday?: number | null;
  /** 1-4, or -1 for last */
  week_of_month?: number | null;
  /** 1-12, for quarterly and longer */
  anchor_month?: number | null;
  next_run?: string | LocalDate | null;
}

/** Months per cadence step (0 = not month-based). */
const STEP_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

/** HANDOFF §6.4: days_of_week is comma-separated, 0 = Sunday. Returns a sorted unique list. */
export function parseDaysOfWeek(daysOfWeek: string | null | undefined): number[] {
  if (!daysOfWeek) return [];
  const days = daysOfWeek
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

function asLocalDate(d: string | LocalDate): LocalDate {
  return typeof d === "string" ? parseLocalDate(d) : d;
}

/**
 * HANDOFF §6.4 day resolution inside a month: by day_of_month (clamped), or
 * by (weekday, week_of_month) with week_of_month 1-4 or -1 for last, or
 * falling back to the rule's current day-of-month (clamped).
 */
export function resolveDayInMonth(
  rule: Pick<RecurringRuleShape, "day_of_month" | "weekday" | "week_of_month">,
  year: number,
  month: number,
  fallbackDay: number,
): number {
  const last = lastDayOfMonth(year, month);
  if (rule.day_of_month) return Math.min(rule.day_of_month, last);
  if (rule.weekday != null && rule.week_of_month) {
    if (rule.week_of_month === -1) {
      // last such weekday of the month
      let d = last;
      while (dayOfWeek({ year, month, day: d }) !== rule.weekday) d--;
      return d;
    }
    const firstDow = dayOfWeek({ year, month, day: 1 });
    const day = 1 + ((rule.weekday - firstDow + 7) % 7) + (rule.week_of_month - 1) * 7;
    return Math.min(day, last); // weeks 1-4 always exist; clamp is belt-and-braces
  }
  return Math.min(fallbackDay, last);
}

/** True when a 1-based month is on this rule's anchor cadence (always true when no anchor). */
function isCadenceMonth(rule: RecurringRuleShape, month: number, step: number): boolean {
  if (!rule.anchor_month) return true;
  const diff = month - rule.anchor_month;
  return ((diff % step) + step) % step === 0;
}

/**
 * HANDOFF §6.4 - moves next_run forward one period: daily +1 day; weekly the
 * next listed weekday; monthly and longer resolving by day_of_month, or by
 * (weekday, week_of_month), or falling back to the same day-of-month, with
 * anchor_month pinning the cadence months for quarterly and longer.
 */
export function advanceNextRun(rule: RecurringRuleShape): LocalDate {
  if (!rule.next_run) throw new Error("advanceNextRun: rule has no next_run");
  const from = asLocalDate(rule.next_run);
  switch (rule.schedule_type) {
    case "daily":
      return addDays(from, 1);
    case "weekly": {
      const days = parseDaysOfWeek(rule.days_of_week);
      if (days.length === 0) return addDays(from, 7);
      for (let k = 1; k <= 7; k++) {
        const candidate = addDays(from, k);
        if (days.includes(dayOfWeek(candidate))) return candidate;
      }
      throw new Error("advanceNextRun: unreachable weekly state");
    }
    default: {
      const step = STEP_MONTHS[rule.schedule_type] ?? 1;
      let cursor: Month = { year: from.year, month: from.month };
      for (let i = 0; i < 120; i++) {
        if (isCadenceMonth(rule, cursor.month, step)) {
          const day = resolveDayInMonth(rule, cursor.year, cursor.month, from.day);
          const candidate = { year: cursor.year, month: cursor.month, day };
          if (compareLocalDate(candidate, from) > 0) return candidate;
        }
        cursor = addMonths(cursor, rule.anchor_month ? 1 : step);
      }
      throw new Error("advanceNextRun: no occurrence within 120 steps");
    }
  }
}

/**
 * HANDOFF §6.4 - the first occurrence on or after a date, used by backfill
 * and year projection.
 */
export function nextRunFrom(rule: RecurringRuleShape, anchor: LocalDate): LocalDate {
  switch (rule.schedule_type) {
    case "daily":
      return anchor;
    case "weekly": {
      const days = parseDaysOfWeek(rule.days_of_week);
      if (days.length === 0) return anchor;
      for (let k = 0; k < 7; k++) {
        const candidate = addDays(anchor, k);
        if (days.includes(dayOfWeek(candidate))) return candidate;
      }
      throw new Error("nextRunFrom: unreachable weekly state");
    }
    default: {
      const step = STEP_MONTHS[rule.schedule_type] ?? 1;
      const fallbackDay = rule.next_run ? asLocalDate(rule.next_run).day : anchor.day;
      let cursor: Month = { year: anchor.year, month: anchor.month };
      for (let i = 0; i < 120; i++) {
        if (isCadenceMonth(rule, cursor.month, step)) {
          const day = resolveDayInMonth(rule, cursor.year, cursor.month, fallbackDay);
          const candidate = { year: cursor.year, month: cursor.month, day };
          if (compareLocalDate(candidate, anchor) >= 0) return candidate;
        }
        cursor = addMonths(cursor, rule.anchor_month ? 1 : step);
      }
      throw new Error("nextRunFrom: no occurrence within 120 steps");
    }
  }
}

/** HANDOFF §6.4: weekend due dates are pushed to Monday. */
export function pushWeekendToMonday(d: LocalDate): LocalDate {
  const dow = dayOfWeek(d);
  if (dow === 6) return addDays(d, 2); // Saturday
  if (dow === 0) return addDays(d, 1); // Sunday
  return d;
}

/**
 * HANDOFF §6.4 - how many occurrences a rule produces in a month; invoicing
 * uses this to bill weekly and daily rules accurately.
 */
export function recurringBillingQuantityForMonth(
  rule: RecurringRuleShape,
  year: number,
  month: number,
): number {
  let count = 0;
  let occurrence = nextRunFrom(rule, { year, month, day: 1 });
  for (let i = 0; i < 40; i++) {
    if (occurrence.year !== year || occurrence.month !== month) break;
    count++;
    occurrence = advanceNextRun({ ...rule, next_run: formatLocalDate(occurrence) });
  }
  return count;
}

/**
 * HANDOFF §6.4 - gates later periods behind earlier ones for
 * prior-period-sensitive work: true when any row BEFORE the target month is
 * incomplete. Rows are duck-typed; the caller supplies the period rows.
 */
export function earlierPeriodIncomplete(
  rows: readonly { year: number; month: number; is_complete: boolean }[],
  target: Month,
): boolean {
  return rows.some(
    (r) =>
      !r.is_complete &&
      (r.year < target.year || (r.year === target.year && r.month < target.month)),
  );
}
