import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setWorkItemCompleted,
  isSettled,
  reverseSyncTargetForTaskTitle,
  bankFeedDueDate,
  reconciliationDueDate,
  reportMonthsForFrequency,
  effectiveDueDate,
  isOverdue,
  DEFAULT_BANK_FEED_DAY_OF_WEEK,
  RECONCILIATION_GRACE_DAYS,
} from "../src/work-item-state.ts";
import type { LocalDate } from "../src/dates.ts";

const ld = (iso: string): LocalDate => {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
};

// ---- Completion semantics (HANDOFF §6.3, work_item_state.py:51) -------------
test("completing stamps completed_at/completed_by_id and CLEARS the parked state", () => {
  const row = {
    completed_at: null,
    completed_by_id: null,
    waiting_on_client: true,
    deferred_until: "2026-03-01",
  };
  const patch = setWorkItemCompleted(row, true, { userId: 7, now: "2026-02-10T14:00:00Z" });
  assert.equal(patch.completed_at, "2026-02-10T14:00:00Z");
  assert.equal(patch.completed_by_id, 7);
  assert.equal(patch.waiting_on_client, false);
  assert.equal(patch.deferred_until, null);
});
test("re-completing an already-complete row preserves the original timestamp", () => {
  const row = { completed_at: "2026-01-05T09:00:00Z", completed_by_id: 3 };
  const patch = setWorkItemCompleted(row, true, { userId: 9, now: "2026-02-10T14:00:00Z" });
  assert.equal(patch.completed_at, "2026-01-05T09:00:00Z"); // bulk syncs don't rewrite history
  assert.equal(patch.completed_by_id, 3);
});
test("re-opening clears the completion stamps", () => {
  const patch = setWorkItemCompleted(
    { completed_at: "2026-01-05T09:00:00Z", completed_by_id: 3 },
    false,
    { userId: 9, now: "2026-02-10T14:00:00Z" },
  );
  assert.equal(patch.completed_at, null);
  assert.equal(patch.completed_by_id, null);
});

// ---- Settled for row→task sync (HANDOFF §6.3: complete OR waiting_on_client)
test("a row counts as settled if complete or waiting on client", () => {
  assert.equal(isSettled({ completed_at: "2026-01-05T09:00:00Z", waiting_on_client: false }), true);
  assert.equal(isSettled({ completed_at: null, waiting_on_client: true }), true);
  assert.equal(isSettled({ completed_at: null, waiting_on_client: false }), false);
});

// ---- Task → row reverse-sync dispatch (HANDOFF §6.3, routes_tasks.py:951) ---
test("reverse-sync dispatches on the task title", () => {
  assert.equal(reverseSyncTargetForTaskTitle("Categorize Transactions"), "bank_feeds");
  assert.equal(reverseSyncTargetForTaskTitle("categorize the transaction batch"), "bank_feeds");
  assert.equal(reverseSyncTargetForTaskTitle("Reconcile Accounts"), "reconciliations"); // EXACT match
  assert.equal(reverseSyncTargetForTaskTitle("Reconcile Accounts - Q1"), null); // substring does NOT match
  assert.equal(reverseSyncTargetForTaskTitle("Send Reports"), "client_reports");
  assert.equal(reverseSyncTargetForTaskTitle("Prepare P&L"), null);
});

// ---- Bank feed due dates (HANDOFF §6.3) --------------------------------------
test("bank feed due = client's day-of-week (default Friday) on/after the period anchor", () => {
  assert.equal(DEFAULT_BANK_FEED_DAY_OF_WEEK, 5); // Friday
  // anchor Monday Aug 17 2026 → Friday Aug 21
  assert.deepEqual(bankFeedDueDate(ld("2026-08-17")), ld("2026-08-21"));
  // anchor already Friday → same day ("on or after")
  assert.deepEqual(bankFeedDueDate(ld("2026-08-21")), ld("2026-08-21"));
  // explicit day: 1 = Monday → anchor is already Monday
  assert.deepEqual(bankFeedDueDate(ld("2026-08-17"), 1), ld("2026-08-17"));
});
test("bank feed due is floored by the catch-up date", () => {
  assert.deepEqual(
    bankFeedDueDate(ld("2026-08-17"), undefined, ld("2026-09-01")),
    ld("2026-09-01"),
  );
});

// ---- Reconciliation due dates (HANDOFF §6.3) ---------------------------------
test("reconciliation due = max(statement_date + 8 days, tier day), floored by catch-up", () => {
  assert.equal(RECONCILIATION_GRACE_DAYS, 8);
  // Jan 2026 books, month-end statement Jan 31, tier 15 → max(Feb 8, Feb 15) = Feb 15
  assert.deepEqual(
    reconciliationDueDate({ year: 2026, month: 1 }, ld("2026-01-31"), 15),
    ld("2026-02-15"),
  );
  // late statement: dated Feb 20, tier 15 → max(Feb 28, Feb 15) = Feb 28
  assert.deepEqual(
    reconciliationDueDate({ year: 2026, month: 1 }, ld("2026-02-20"), 15),
    ld("2026-02-28"),
  );
  // non-monthly client (tier null) → default 15th of the following month
  assert.deepEqual(
    reconciliationDueDate({ year: 2026, month: 1 }, ld("2026-01-31"), null),
    ld("2026-02-15"),
  );
  // catch-up floor wins when later
  assert.deepEqual(
    reconciliationDueDate({ year: 2026, month: 1 }, ld("2026-01-31"), 15, ld("2026-03-01")),
    ld("2026-03-01"),
  );
});

// ---- Report months per frequency (HANDOFF §6.3) ------------------------------
test("report months: monthly all 12, quarterly 3/6/9/12, semi-annual 6/12, annual 12", () => {
  assert.deepEqual(reportMonthsForFrequency("monthly"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(reportMonthsForFrequency("quarterly"), [3, 6, 9, 12]);
  assert.deepEqual(reportMonthsForFrequency("semi_annual"), [6, 12]);
  assert.deepEqual(reportMonthsForFrequency("annual"), [12]);
});

// ---- Catch-up + deferred-until due semantics (HANDOFF §32, §22) --------------
test("catch-up date floors a past due date", () => {
  assert.deepEqual(
    effectiveDueDate(ld("2026-01-10"), { catchupDate: ld("2026-03-01") }),
    ld("2026-03-01"),
  );
});
test("catch-up date never pushes a future due date later", () => {
  assert.deepEqual(
    effectiveDueDate(ld("2026-04-10"), { catchupDate: ld("2026-03-01") }),
    ld("2026-04-10"),
  );
});
test("deferred-until parks overdue-ness until the date passes", () => {
  const due = ld("2026-01-10");
  assert.equal(isOverdue(due, ld("2026-02-01"), { deferredUntil: ld("2026-03-01") }), false);
  assert.equal(isOverdue(due, ld("2026-03-01"), { deferredUntil: ld("2026-03-01") }), true);
});
test("catch-up + deferred combine (later wins)", () => {
  assert.deepEqual(
    effectiveDueDate(ld("2026-01-10"), {
      catchupDate: ld("2026-02-01"),
      deferredUntil: ld("2026-03-01"),
    }),
    ld("2026-03-01"),
  );
});
