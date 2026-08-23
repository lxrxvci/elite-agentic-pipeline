/**
 * @firmos/attribution — FirmOS domain core.
 *
 * Pure, dependency-free port of Yecny Bookkeeping OS's hardest-won rules
 * (HANDOFF.pdf §§6–7, 21). Every export cites its source section and is
 * flagged DIFFERENTIAL-VALIDATE until green against the original Python
 * fixtures (attribution.py / time_tracking_utils.py / client_state.py).
 */

export type CloseTier = 5 | 10 | 15;

/** A calendar month, 1-based month. */
export interface Month {
  year: number;
  month: number; // 1..12
}

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms, exclusive
}

const MS_PER_MINUTE = 60_000;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * HANDOFF §32 ("Close tier"): a monthly client's promised delivery day —
 * the 5th, 10th, or 15th of the FOLLOWING month. This is the due date for
 * an accounting month's work.
 */
export function closeTierDueDate(m: Month, tier: CloseTier): Date {
  const next = addMonths(m, 1);
  const day = Math.min(tier, lastDayOfMonth(next.year, next.month));
  return new Date(Date.UTC(next.year, next.month - 1, day));
}

export function addMonths(m: Month, n: number): Month {
  const zero = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * HANDOFF §32 ("Catch-up date"): "Everything older than this is due by this
 * date" — floors due dates so a newly onboarded or behind client stops
 * showing a wall of false overdues (§22).
 *
 * HANDOFF §32 ("Deferred until"): a date BEFORE WHICH an item is not overdue.
 */
export function effectiveDueDate(
  due: Date,
  opts: { catchupDate?: Date; deferredUntil?: Date } = {},
): Date {
  let effective = due;
  if (opts.catchupDate && due < opts.catchupDate) effective = opts.catchupDate;
  if (opts.deferredUntil && effective < opts.deferredUntil)
    effective = opts.deferredUntil;
  return effective;
}

/** An item is overdue when `now` is at/after its effective due date. */
export function isOverdue(
  due: Date,
  now: Date,
  opts: { catchupDate?: Date; deferredUntil?: Date } = {},
): boolean {
  return effectiveDueDate(due, opts).getTime() <= now.getTime();
}

/**
 * HANDOFF §21 ("Client health"): base score is the equal-weighted mean of the
 * completion percentage of each APPLICABLE category, or 100 if none apply.
 * Penalty = min(40, overdue_count × 10), floored at zero overall.
 */
export type HealthStatus = "overdue" | "up_to_date" | "in_progress";

export interface HealthCategory {
  /** e.g. "bank_feeds", "reconciliations", "reports" */
  name: string;
  /** false ⇒ excluded from both the mean and the denominator (§21 exclusions) */
  applicable: boolean;
  /** 0..100 */
  completion: number;
}

export function clientHealthScore(
  categories: HealthCategory[],
  overdueNonCategoryTasks: number,
): { score: number; status: HealthStatus } {
  const applicable = categories.filter((c) => c.applicable);
  const base =
    applicable.length === 0
      ? 100
      : applicable.reduce((sum, c) => sum + Math.min(100, Math.max(0, c.completion)), 0) /
        applicable.length;
  const penalty = Math.min(40, overdueNonCategoryTasks * 10);
  const score = Math.max(0, Math.round(base - penalty));
  const status: HealthStatus =
    penalty > 0 ? "overdue" : score >= 95 ? "up_to_date" : "in_progress";
  return { score, status };
}

/**
 * HANDOFF §17 / time_tracking_utils.py: day clock, activity timer, and task
 * timer OVERLAP BY DESIGN; totals use a wall-clock UNION so concurrent timers
 * are not double-counted.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of valid) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Set difference a \ b over interval unions. */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const bs = mergeIntervals(b);
  let remaining = mergeIntervals(a);
  for (const cut of bs) {
    const next: Interval[] = [];
    for (const iv of remaining) {
      if (iv.end <= cut.start || iv.start >= cut.end) {
        next.push(iv); // disjoint
        continue;
      }
      if (iv.start < cut.start) next.push({ start: iv.start, end: cut.start });
      if (iv.end > cut.end) next.push({ start: cut.end, end: iv.end });
    }
    remaining = next;
  }
  return remaining;
}

/** Total minutes covered by the union of intervals (merged first). */
export function mergedMinutes(intervals: Interval[]): number {
  return (
    mergeIntervals(intervals).reduce((s, i) => s + (i.end - i.start), 0) /
    MS_PER_MINUTE
  );
}
