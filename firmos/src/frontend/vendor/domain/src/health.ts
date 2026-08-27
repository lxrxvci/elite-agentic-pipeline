/**
 * @firmos/domain - client health scoring (HANDOFF §21).
 *
 * Base = equal-weighted mean of each APPLICABLE category's completion %, or
 * 100 when none apply; minus min(40, overdue_count × 10) for overdue
 * non-category tasks; floored at zero. Status: Overdue when any penalty
 * applies, Up to Date at ≥95, otherwise In Progress.
 */

import { compareLocalDate, type LocalDate } from "./dates.ts";

/** HANDOFF §21 constants. */
export const MAX_OVERDUE_PENALTY = 40;
export const OVERDUE_PENALTY_PER_TASK = 10;
export const UP_TO_DATE_THRESHOLD = 95;

export type HealthStatus = "overdue" | "up_to_date" | "in_progress";

export interface HealthCategory {
  /** e.g. "bank_feeds", "reconciliations", "reports" */
  name: string;
  /** false ⇒ excluded from both the mean and the denominator (§21 exclusions) */
  applicable: boolean;
  /** 0..100 */
  completion: number;
}

/** HANDOFF §21 formula, verbatim. */
export function clientHealthScore(
  categories: readonly HealthCategory[],
  overdueNonCategoryTasks: number,
): { score: number; status: HealthStatus } {
  const applicable = categories.filter((c) => c.applicable);
  const base =
    applicable.length === 0
      ? 100
      : applicable.reduce((sum, c) => sum + Math.min(100, Math.max(0, c.completion)), 0) /
        applicable.length;
  const penalty = Math.min(MAX_OVERDUE_PENALTY, overdueNonCategoryTasks * OVERDUE_PENALTY_PER_TASK);
  const score = Math.max(0, Math.round(base - penalty));
  const status: HealthStatus =
    penalty > 0 ? "overdue" : score >= UP_TO_DATE_THRESHOLD ? "up_to_date" : "in_progress";
  return { score, status };
}

/**
 * Duck-typed periodic row for category computation. HANDOFF §21 exclusions:
 * waiting-on-client rows, deferred feeds, and pre-catch-up periods never
 * count toward a category (nor against it).
 */
export interface HealthRow {
  completed: boolean;
  due_date?: LocalDate | null;
  waiting_on_client?: boolean | null;
  deferred_until?: LocalDate | null;
}

export interface HealthCountOptions {
  catchupDate?: LocalDate | null;
}

/** True when a row participates in its category's completion percentage. */
export function isHealthCountable(row: HealthRow, opts: HealthCountOptions = {}): boolean {
  if (row.waiting_on_client) return false;
  if (row.deferred_until) return false;
  if (opts.catchupDate && row.due_date && compareLocalDate(row.due_date, opts.catchupDate) < 0) {
    return false; // pre-catch-up period
  }
  return true;
}

/**
 * Completion % of the countable rows, or null when no row applies (the
 * category is then excluded from the health mean entirely).
 */
export function categoryCompletion(
  rows: readonly HealthRow[],
  opts: HealthCountOptions = {},
): number | null {
  const countable = rows.filter((r) => isHealthCountable(r, opts));
  if (countable.length === 0) return null;
  const done = countable.filter((r) => r.completed).length;
  return (done / countable.length) * 100;
}
