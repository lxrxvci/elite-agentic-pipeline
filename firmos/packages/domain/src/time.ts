/**
 * @firmos/domain - time tracking interval math (HANDOFF §6.6,
 * time_tracking_utils.py).
 *
 * The day clock, activity timer, and task timer OVERLAP BY DESIGN - you are
 * clocked in for the day, on an activity, and on a task all at once. Summing
 * them triple-counts, so totals use a wall-clock UNION, and "General" time
 * is day time minus activities minus task time.
 */

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms, exclusive
}

const MS_PER_MINUTE = 60_000;

/** Wall-clock union of possibly-overlapping intervals (merged, sorted). */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of valid) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push(iv);
    }
  }
  return out;
}

/** Set difference a \ b over interval unions. */
export function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
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
export function mergedMinutes(intervals: readonly Interval[]): number {
  return (
    mergeIntervals(intervals).reduce((s, i) => s + (i.end - i.start), 0) /
    MS_PER_MINUTE
  );
}

/**
 * HANDOFF §6.6: "General" time = day clock − activity timers − task timers,
 * computed on the merged unions so overlapping timers are never
 * double-counted (payroll merges this way; see §29 for the commission
 * report's known raw-sum divergence).
 */
export function generalTimeMinutes(
  dayIntervals: readonly Interval[],
  activityIntervals: readonly Interval[],
  taskIntervals: readonly Interval[],
): number {
  const general = subtractIntervals(
    subtractIntervals(dayIntervals, activityIntervals),
    taskIntervals,
  );
  return mergedMinutes(general);
}

// ── Break typing (owner walkthrough F2, 02:08:30) ─────────────────────────
//
// Breaks and lunches ride the activity timer as first-class kinds, in paid
// and unpaid variants. The paid variants are ordinary work-adjacent time
// (they stay inside the wall-clock union); the UNPAID variants are the only
// intervals payroll subtracts, so an unpaid lunch never inflates paid hours
// even though the day session spans it.

/** Activity-timer kinds that are breaks (paid or unpaid). */
export const BREAK_ACTIVITY_TYPES = [
  "break_paid",
  "break_unpaid",
  "lunch_paid",
  "lunch_unpaid",
] as const;
export type BreakActivityType = (typeof BREAK_ACTIVITY_TYPES)[number];

/** The activity kinds whose intervals are excluded from paid-hours math. */
export const UNPAID_ACTIVITY_TYPES = ["break_unpaid", "lunch_unpaid"] as const;

/** True when the activity type is a break or lunch (paid or unpaid). */
export function isBreakActivityType(activityType: string): boolean {
  return (BREAK_ACTIVITY_TYPES as readonly string[]).includes(activityType);
}

/** True when the activity type is unpaid time (excluded from payroll). */
export function isUnpaidActivityType(activityType: string): boolean {
  return (UNPAID_ACTIVITY_TYPES as readonly string[]).includes(activityType);
}

/**
 * Paid time: the wall-clock union of every work interval with the unpaid
 * break/lunch intervals cut out of it. Identity when there is no unpaid time.
 */
export function paidMinutes(
  workIntervals: readonly Interval[],
  unpaidBreakIntervals: readonly Interval[],
): number {
  return mergedMinutes(subtractIntervals(workIntervals, unpaidBreakIntervals));
}
