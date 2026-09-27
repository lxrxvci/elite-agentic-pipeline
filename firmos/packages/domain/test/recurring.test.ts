import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDaysOfWeek,
  resolveDayInMonth,
  advanceNextRun,
  nextRunFrom,
  pushWeekendToMonday,
  recurringBillingQuantityForMonth,
  earlierPeriodIncomplete,
} from "../src/recurring.ts";
import type { LocalDate } from "../src/dates.ts";

const ld = (iso: string): LocalDate => {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
};

// ---- days_of_week parsing (HANDOFF §6.4: comma-separated, 0=Sunday) --------
test("parseDaysOfWeek parses comma-separated 0=Sunday values", () => {
  assert.deepEqual(parseDaysOfWeek("1,3,5"), [1, 3, 5]);
  assert.deepEqual(parseDaysOfWeek("0"), [0]);
  assert.deepEqual(parseDaysOfWeek(""), []);
  assert.deepEqual(parseDaysOfWeek(null), []);
  assert.deepEqual(parseDaysOfWeek(" 5 , 1 "), [1, 5]); // sorted, trimmed
});

// ---- day resolution inside a month (HANDOFF §6.4) ---------------------------
test("resolveDayInMonth: day_of_month wins and clamps to month length", () => {
  assert.equal(resolveDayInMonth({ day_of_month: 31 }, 2026, 2, 15), 28);
  assert.equal(resolveDayInMonth({ day_of_month: 31 }, 2026, 3, 15), 31);
});
test("resolveDayInMonth: (weekday, week_of_month) picks the nth weekday", () => {
  // 2nd Tuesday of September 2026 (Sep 1 is a Tuesday) → Sep 8
  assert.equal(resolveDayInMonth({ weekday: 2, week_of_month: 2 }, 2026, 9, 15), 8);
  // week_of_month -1 = LAST Friday of August 2026 → Aug 28
  assert.equal(resolveDayInMonth({ weekday: 5, week_of_month: -1 }, 2026, 8, 15), 28);
  // 4th Sunday of February 2026 → Feb 22
  assert.equal(resolveDayInMonth({ weekday: 0, week_of_month: 4 }, 2026, 2, 15), 22);
});
test("resolveDayInMonth: fallback is the rule's current day-of-month, clamped", () => {
  assert.equal(resolveDayInMonth({}, 2026, 2, 31), 28);
  assert.equal(resolveDayInMonth({}, 2026, 3, 31), 31);
});

// ---- advance_next_run (HANDOFF §6.4: one period forward) --------------------
test("daily advances one day", () => {
  assert.deepEqual(advanceNextRun({ schedule_type: "daily", next_run: "2026-02-28" }), ld("2026-03-01"));
});
test("weekly walks days_of_week strictly forward", () => {
  // Wednesday Aug 19 2026 → Friday Aug 21 → Monday Aug 24
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", days_of_week: "1,3,5", next_run: "2026-08-19" }),
    ld("2026-08-21"),
  );
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", days_of_week: "1,3,5", next_run: "2026-08-21" }),
    ld("2026-08-24"),
  );
  // no days_of_week → same weekday next week
  assert.deepEqual(advanceNextRun({ schedule_type: "weekly", next_run: "2026-08-19" }), ld("2026-08-26"));
});
test("weekly every-N-weeks (J3/R4): skips the off weeks", () => {
  // Every 2 weeks on Friday: Aug 7 2026 → Aug 21 → Sep 4 (never Aug 14).
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", days_of_week: "5", week_interval: 2, next_run: "2026-08-07" }),
    ld("2026-08-21"),
  );
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", days_of_week: "5", week_interval: 2, next_run: "2026-08-21" }),
    ld("2026-09-04"),
  );
  // Multi-day with an interval: the first listed weekday in the target week.
  // From Wednesday Aug 5 with Wed+Fri every 2 weeks → Wednesday Aug 19.
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", days_of_week: "3,5", week_interval: 2, next_run: "2026-08-05" }),
    ld("2026-08-19"),
  );
  // Every 3 weeks; no days_of_week → the same weekday N weeks out.
  assert.deepEqual(
    advanceNextRun({ schedule_type: "weekly", week_interval: 3, next_run: "2026-08-19" }),
    ld("2026-09-09"),
  );
});
test("monthly resolves by day_of_month across a short month", () => {
  const rule = { schedule_type: "monthly", day_of_month: 31, next_run: "2026-01-31" };
  assert.deepEqual(advanceNextRun(rule), ld("2026-02-28"));
  assert.deepEqual(
    advanceNextRun({ ...rule, next_run: "2026-02-28" }),
    ld("2026-03-31"), // day_of_month survives the clamp
  );
});
test("monthly resolves by (weekday, week_of_month)", () => {
  // 2nd Tuesday: Sep 8 2026 → Oct 13 2026
  assert.deepEqual(
    advanceNextRun({ schedule_type: "monthly", weekday: 2, week_of_month: 2, next_run: "2026-09-08" }),
    ld("2026-10-13"),
  );
});
test("quarterly/semi-annual/annual honor anchor_month", () => {
  assert.deepEqual(
    advanceNextRun({ schedule_type: "quarterly", day_of_month: 15, anchor_month: 1, next_run: "2026-01-15" }),
    ld("2026-04-15"),
  );
  // anchor_month 2 → cadence months are Feb/May/Aug/Nov
  assert.deepEqual(
    advanceNextRun({ schedule_type: "quarterly", day_of_month: 15, anchor_month: 2, next_run: "2026-02-15" }),
    ld("2026-05-15"),
  );
  assert.deepEqual(
    advanceNextRun({ schedule_type: "semi_annual", day_of_month: 15, anchor_month: 1, next_run: "2026-01-15" }),
    ld("2026-07-15"),
  );
  assert.deepEqual(
    advanceNextRun({ schedule_type: "annual", day_of_month: 15, anchor_month: 3, next_run: "2026-03-15" }),
    ld("2027-03-15"),
  );
});

// ---- next_run_from (HANDOFF §6.4: first occurrence on/after the anchor) -----
test("nextRunFrom finds the first occurrence on or after the anchor", () => {
  assert.deepEqual(
    nextRunFrom({ schedule_type: "monthly", day_of_month: 15 }, ld("2026-08-10")),
    ld("2026-08-15"),
  );
  assert.deepEqual(
    nextRunFrom({ schedule_type: "monthly", day_of_month: 15 }, ld("2026-08-20")),
    ld("2026-09-15"),
  );
  // on the day itself counts ("on or after")
  assert.deepEqual(
    nextRunFrom({ schedule_type: "monthly", day_of_month: 15 }, ld("2026-08-15")),
    ld("2026-08-15"),
  );
  assert.deepEqual(
    nextRunFrom({ schedule_type: "weekly", days_of_week: "5" }, ld("2026-08-23")), // Sunday → Friday
    ld("2026-08-28"),
  );
  // Every-2-weeks Fridays anchored on the week of the rule's next_run
  // (Mon Aug 3): the Aug 10 anchor skips the off-week Friday (Aug 14).
  assert.deepEqual(
    nextRunFrom(
      { schedule_type: "weekly", days_of_week: "5", week_interval: 2, next_run: "2026-08-03" },
      ld("2026-08-03"),
    ),
    ld("2026-08-07"),
  );
  assert.deepEqual(
    nextRunFrom(
      { schedule_type: "weekly", days_of_week: "5", week_interval: 2, next_run: "2026-08-03" },
      ld("2026-08-10"),
    ),
    ld("2026-08-21"),
  );
  assert.deepEqual(nextRunFrom({ schedule_type: "daily" }, ld("2026-08-23")), ld("2026-08-23"));
  // quarterly anchored to January, anchored mid-quarter → next cadence month
  assert.deepEqual(
    nextRunFrom({ schedule_type: "quarterly", day_of_month: 10, anchor_month: 1 }, ld("2026-02-01")),
    ld("2026-04-10"),
  );
});

// ---- Weekend due dates pushed to Monday (HANDOFF §6.4) -----------------------
test("weekend due dates push to Monday; weekdays are unchanged", () => {
  assert.deepEqual(pushWeekendToMonday(ld("2026-08-22")), ld("2026-08-24")); // Sat → Mon
  assert.deepEqual(pushWeekendToMonday(ld("2026-08-23")), ld("2026-08-24")); // Sun → Mon
  assert.deepEqual(pushWeekendToMonday(ld("2026-08-21")), ld("2026-08-21")); // Friday stays
});

// ---- recurring_billing_quantity_for_month (HANDOFF §6.4) ---------------------
test("billing quantity counts a rule's occurrences inside a month", () => {
  // Mon/Wed/Fri in August 2026: 5 Mondays + 4 Wednesdays + 4 Fridays
  assert.equal(
    recurringBillingQuantityForMonth({ schedule_type: "weekly", days_of_week: "1,3,5" }, 2026, 8),
    13,
  );
  assert.equal(recurringBillingQuantityForMonth({ schedule_type: "monthly", day_of_month: 15 }, 2026, 8), 1);
  assert.equal(recurringBillingQuantityForMonth({ schedule_type: "daily" }, 2026, 2), 28);
  // quarterly anchored to January produces nothing in February
  assert.equal(
    recurringBillingQuantityForMonth(
      { schedule_type: "quarterly", day_of_month: 10, anchor_month: 1 },
      2026,
      2,
    ),
    0,
  );
  // Every-2-weeks Fridays anchored on Aug 7 2026: Aug 7 + Aug 21 = 2 that
  // month, and the cadence phase carries into September (Sep 4 + Sep 18).
  const biweeklyFriday = {
    schedule_type: "weekly",
    days_of_week: "5",
    week_interval: 2,
    next_run: "2026-08-07",
  };
  assert.equal(recurringBillingQuantityForMonth(biweeklyFriday, 2026, 8), 2);
  assert.equal(recurringBillingQuantityForMonth(biweeklyFriday, 2026, 9), 2);
});

// ---- earlier_period_incomplete (HANDOFF §6.4 gating) -------------------------
test("earlierPeriodIncomplete gates later periods behind earlier ones", () => {
  const rows = [
    { year: 2026, month: 1, is_complete: true },
    { year: 2026, month: 2, is_complete: false },
    { year: 2026, month: 4, is_complete: false },
  ];
  assert.equal(earlierPeriodIncomplete(rows, { year: 2026, month: 3 }), true); // Feb open
  assert.equal(earlierPeriodIncomplete(rows, { year: 2026, month: 2 }), false); // Jan done
  assert.equal(earlierPeriodIncomplete(rows, { year: 2026, month: 1 }), false); // nothing earlier
  assert.equal(earlierPeriodIncomplete(rows, { year: 2025, month: 12 }), false);
});
