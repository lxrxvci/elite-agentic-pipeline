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
