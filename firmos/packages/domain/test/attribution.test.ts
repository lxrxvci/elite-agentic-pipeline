import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTRIBUTION_CUTOFF_DAY,
  WORK_PERIOD_CUTOFF_DAY,
  PRIOR_PERIOD_SCHEDULES,
  priorMonth,
  followingMonth,
  tierDayForClient,
  attributionCutoff,
  closeTierDueDate,
  statementReleaseDate,
  attributedPeriodForDate,
  resolveAttributedPeriod,
  nextUpcomingStatement,
  isReportTaskName,
  workPeriodForDue,
  workPeriodForTask,
  workPeriodForRule,
  workPeriodForRow,
} from "../src/attribution.ts";
import { lastDayOfMonth, formatLocalDate, type LocalDate } from "../src/dates.ts";

const ld = (iso: string): LocalDate => {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
};

// ---- Constants (HANDOFF §6.1) ----------------------------------------------
test("cutoff constants are the handoff values", () => {
  assert.equal(DEFAULT_ATTRIBUTION_CUTOFF_DAY, 15); // attribution.py:57
  assert.equal(WORK_PERIOD_CUTOFF_DAY, 20); // attribution.py:220
  assert.deepEqual([...PRIOR_PERIOD_SCHEDULES].sort(), ["annual", "quarterly", "semi_annual"]);
});

// ---- Tier resolution (HANDOFF §6.1 RULE 1) ----------------------------------
test("only monthly clients get a tier day; non-monthly → null (→ default 15)", () => {
  assert.equal(tierDayForClient({ bookkeeping_frequency: "monthly", monthly_close_tier: 5 }), 5);
  assert.equal(tierDayForClient({ bookkeeping_frequency: "monthly", monthly_close_tier: 10 }), 10);
  assert.equal(tierDayForClient({ bookkeeping_frequency: "monthly", monthly_close_tier: 15 }), 15);
  assert.equal(tierDayForClient({ bookkeeping_frequency: "quarterly", monthly_close_tier: 10 }), null);
  assert.equal(tierDayForClient({ bookkeeping_frequency: "annual" }), null);
  assert.equal(tierDayForClient({ bookkeeping_frequency: "monthly" }), null); // unset → default downstream
  assert.equal(attributionCutoff(null), 15);
  assert.equal(attributionCutoff(10), 10);
});

// ---- Close tier due dates (HANDOFF §32 "Close tier") ------------------------
test("close tier 5: January work is due Feb 5", () => {
  assert.deepEqual(closeTierDueDate({ year: 2026, month: 1 }, 5), { year: 2026, month: 2, day: 5 });
});
test("close tier 15: December work is due Jan 15 next year", () => {
  assert.deepEqual(closeTierDueDate({ year: 2026, month: 12 }, 15), { year: 2027, month: 1, day: 15 });
});

// ---- RULE 1: the three worked examples, verbatim (HANDOFF §6.1) -------------
test("WORKED EXAMPLE 1 - quarterly client, statement_day 4, dated Feb 4 2026 → (2026,1)", () => {
  // quarterly → no tier day → cutoff 15; Feb 4 is before the 15th → previous month
  assert.deepEqual(attributedPeriodForDate(4, ld("2026-02-04"), null), { year: 2026, month: 1 });
});
test("WORKED EXAMPLE 2 - statement_day 31, dated Jan 31 2026 → (2026,1); same with no statement day", () => {
  assert.deepEqual(attributedPeriodForDate(31, ld("2026-01-31"), null), { year: 2026, month: 1 });
  assert.deepEqual(attributedPeriodForDate(null, ld("2026-01-31"), null), { year: 2026, month: 1 });
});
test("WORKED EXAMPLE 3 - monthly tier 15, statement_day 20, dated Feb 20 → (2026,2)", () => {
  assert.deepEqual(attributedPeriodForDate(20, ld("2026-02-20"), 15), { year: 2026, month: 2 });
});
test('landing exactly on the cutoff keeps its own month; "before" is strict', () => {
  assert.deepEqual(attributedPeriodForDate(15, ld("2026-02-15"), 15), { year: 2026, month: 2 });
  assert.deepEqual(attributedPeriodForDate(15, ld("2026-02-14"), 15), { year: 2026, month: 1 });
});
test("a statement dated on/after the last day of its month → that month (grid round-trip)", () => {
  assert.deepEqual(attributedPeriodForDate(4, ld("2026-02-28"), null), { year: 2026, month: 2 });
  assert.deepEqual(attributedPeriodForDate(4, ld("2024-02-29"), null), { year: 2024, month: 2 });
});
test("statement_day 0 behaves like None (end-of-month account → own month)", () => {
  assert.deepEqual(attributedPeriodForDate(0, ld("2026-03-10"), 5), { year: 2026, month: 3 });
});
test("tier day shifts the mid-month cutoff for monthly clients", () => {
  // tier 5: dated Mar 6 → own month; dated Mar 4 → previous month
  assert.deepEqual(attributedPeriodForDate(6, ld("2026-03-06"), 5), { year: 2026, month: 3 });
  assert.deepEqual(attributedPeriodForDate(6, ld("2026-03-04"), 5), { year: 2026, month: 2 });
});

// ---- statement_release_date (HANDOFF §6.1: "when the statement covering an
//      accounting month is issued") -------------------------------------------
test("mid-month day below cutoff: January's statement is issued Feb 4", () => {
  assert.deepEqual(statementReleaseDate(4, 2026, 1, null), ld("2026-02-04"));
});
test("mid-month day at/after cutoff: February's statement is issued Feb 20", () => {
  assert.deepEqual(statementReleaseDate(20, 2026, 2, 15), ld("2026-02-20"));
});
test("end-of-month account: statement is dated the last day of its own month", () => {
  assert.deepEqual(statementReleaseDate(31, 2026, 1, null), ld("2026-01-31"));
  assert.deepEqual(statementReleaseDate(31, 2026, 2, null), ld("2026-02-28")); // clamps
  assert.deepEqual(statementReleaseDate(null, 2026, 2, null), ld("2026-02-28"));
  assert.deepEqual(statementReleaseDate(0, 2026, 12, 10), ld("2026-12-31"));
});

// ---- INVERSE INVARIANT (HANDOFF §6.1): release ∘ attribute = identity -------
test("statementReleaseDate and attributedPeriodForDate are exact inverses (sweep)", () => {
  const statementDays: (number | null)[] = [null, 0, ...Array.from({ length: 31 }, (_, i) => i + 1)];
  const tiers: (5 | 10 | 15 | null)[] = [null, 5, 10, 15];
  for (const sd of statementDays) {
    for (const tier of tiers) {
      for (let year = 2025; year <= 2027; year++) {
        for (let month = 1; month <= 12; month++) {
          const release = statementReleaseDate(sd, year, month, tier);
          const back = attributedPeriodForDate(sd, release, tier);
          assert.deepEqual(
            back,
            { year, month },
            `round-trip failed for statement_day=${sd} tier=${tier} ${year}-${month} (release ${formatLocalDate(release)})`,
          );
        }
      }
    }
  }
});

// ---- resolve_attributed_period (HANDOFF §6.1 + §29 quirk: explicit period
//      honored only for the genuinely ambiguous month-end case) ---------------
test("explicit period is honored for a month-end statement date", () => {
  // derived would be (2026,1); the clicked grid cell says December
  assert.deepEqual(
    resolveAttributedPeriod(31, ld("2026-01-31"), null, 2025, 12),
    { year: 2025, month: 12 },
  );
});
test("explicit period is DISCARDED for any non-month-end statement date", () => {
  assert.deepEqual(
    resolveAttributedPeriod(4, ld("2026-02-04"), null, 2026, 2),
    { year: 2026, month: 1 }, // derived wins
  );
});
test("no explicit period → derived", () => {
  assert.deepEqual(resolveAttributedPeriod(20, ld("2026-02-20"), 15), { year: 2026, month: 2 });
});

// ---- next_upcoming_statement (HANDOFF §6.1/§6.7) -----------------------------
test("walks from the required start to the first month without a statement", () => {
  const next = nextUpcomingStatement(null, [{ year: 2026, month: 1 }], ld("2026-03-01"), null, {
    year: 2026,
    month: 1,
  });
  assert.deepEqual(next, {
    year: 2026,
    month: 2,
    releaseDate: { year: 2026, month: 2, day: 28 },
  });
});
test("returns the next FUTURE release when there are no gaps", () => {
  const next = nextUpcomingStatement(
    20,
    [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ],
    ld("2026-03-01"),
    15,
    { year: 2026, month: 1 },
  );
  assert.deepEqual(next, {
    year: 2026,
    month: 3,
    releaseDate: { year: 2026, month: 3, day: 20 },
  });
});
test("returns null when every walked month is present", () => {
  const next = nextUpcomingStatement(
    null,
    [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ],
    ld("2026-03-01"),
    null,
    { year: 2026, month: 1 },
    3, // walk at most 3 months
  );
  assert.equal(next, null);
});

// ---- RULE 2: the work-item rule (HANDOFF §6.1) -------------------------------
test("due on/before the 20th → prior month; after the 20th → own month", () => {
  assert.deepEqual(workPeriodForDue(ld("2026-04-05")), { year: 2026, month: 3 }); // March's books due early April
  assert.deepEqual(workPeriodForDue(ld("2026-03-20")), { year: 2026, month: 2 }); // on the 20th → prior
  assert.deepEqual(workPeriodForDue(ld("2026-03-21")), { year: 2026, month: 3 });
  assert.deepEqual(workPeriodForDue(ld("2026-01-01")), { year: 2025, month: 12 }); // year boundary
});
test("report task names: starts with 'prepare ' or contains 'send report'", () => {
  assert.equal(isReportTaskName("Prepare P&L"), true);
  assert.equal(isReportTaskName("prepare balance sheet"), true);
  assert.equal(isReportTaskName("Send report to client"), true);
  assert.equal(isReportTaskName("please SEND REPORT now"), true);
  assert.equal(isReportTaskName("Reconcile Accounts"), false);
  assert.equal(isReportTaskName("Preparedness review"), false); // not "prepare " prefix
});
test("report tasks always go backwards, regardless of due date", () => {
  assert.deepEqual(
    workPeriodForTask(ld("2026-03-31"), { name: "Prepare P&L" }),
    { year: 2026, month: 2 },
  );
  assert.deepEqual(
    workPeriodForTask(ld("2026-03-05"), { name: "Send Reports" }),
    { year: 2026, month: 2 },
  );
});
test("quarterly/semi-annual/annual cadences always go backwards (30th/31st fix)", () => {
  for (const scheduleType of PRIOR_PERIOD_SCHEDULES) {
    assert.deepEqual(
      workPeriodForTask(ld("2026-03-31"), { scheduleType }),
      { year: 2026, month: 2 },
      scheduleType,
    );
  }
  // a plain monthly/weekly task on the 31st follows the day-of-month rule
  assert.deepEqual(workPeriodForTask(ld("2026-03-31"), { scheduleType: "monthly" }), {
    year: 2026,
    month: 3,
  });
});
test("workPeriodForRule reads rule-shaped objects", () => {
  assert.deepEqual(
    workPeriodForRule({ title: "Prepare P&L", schedule_type: "monthly" }, ld("2026-03-25")),
    { year: 2026, month: 2 },
  );
});
test("workPeriodForRow: stored attributed_year/attributed_month always wins", () => {
  // catch-up rows share one due date; derivation would collapse them (§6.1)
  assert.deepEqual(
    workPeriodForRow({
      attributed_year: 2025,
      attributed_month: 9,
      due_date: "2026-03-05",
      schedule_type: "monthly",
    }),
    { year: 2025, month: 9 },
  );
  // missing stored columns → derive from the due date
  assert.deepEqual(workPeriodForRow({ due_date: "2026-03-05", schedule_type: "monthly" }), {
    year: 2026,
    month: 2,
  });
});

// ---- month helpers -----------------------------------------------------------
test("priorMonth / followingMonth cross year boundaries", () => {
  assert.deepEqual(priorMonth(2026, 1), { year: 2025, month: 12 });
  assert.deepEqual(followingMonth(2026, 12), { year: 2027, month: 1 });
});

// silence unused-import warning for the documented helper
void lastDayOfMonth;
