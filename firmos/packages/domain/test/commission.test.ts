import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMISSION_TIERS,
  onTimePercent,
  commissionRate,
  commissionPayoutDate,
  semiMonthlyPeriods,
  invoiceCountsForCommission,
  totalPay,
} from "../src/commission.ts";
import { mergedMinutes, type Interval } from "../src/time.ts";

const iv = (a: string, b: string): Interval => ({
  start: new Date(a).getTime(),
  end: new Date(b).getTime(),
});

// ---- On-time percentage (HANDOFF §6.6) --------------------------------------
test("on-time % = (tasks on time + feeds on time) / (tasks due + feeds due)", () => {
  // cancelled / waiting-on-client / catch-up-dated / paused work is excluded
  // by the CALLER before counting; the ratio itself is plain.
  assert.equal(onTimePercent({ tasksOnTime: 9, feedsOnTime: 1, tasksDue: 10, feedsDue: 2 }), (10 / 12) * 100);
  assert.equal(onTimePercent({ tasksOnTime: 0, feedsOnTime: 0, tasksDue: 0, feedsDue: 0 }), null); // no data
});

// ---- Tier boundaries (HANDOFF §6.6/§15, verbatim) ----------------------------
test("tier boundaries: 100→50, 90–99→45, 80–89→40, <80 and no-data→35", () => {
  assert.equal(commissionRate(100), 50);
  assert.equal(commissionRate(99.9), 45);
  assert.equal(commissionRate(90), 45);
  assert.equal(commissionRate(89.9), 40);
  assert.equal(commissionRate(80), 40);
  assert.equal(commissionRate(79.9), 35);
  assert.equal(commissionRate(null), 35); // the no-data case
  assert.deepEqual(COMMISSION_TIERS, [
    { minOnTimePercent: 100, rate: 50 },
    { minOnTimePercent: 90, rate: 45 },
    { minOnTimePercent: 80, rate: 40 },
    { minOnTimePercent: 0, rate: 35 },
  ]);
});
test("a per-user commission_rate_override bypasses the tiers entirely", () => {
  assert.equal(commissionRate(100, 42), 42);
  assert.equal(commissionRate(null, 42), 42);
});

// ---- Semi-monthly periods (HANDOFF §15) --------------------------------------
test("periods run 1st–15th (paid the 20th) and 16th–end (paid the 5th of next month)", () => {
  assert.deepEqual(semiMonthlyPeriods(2026, 2), [
    {
      key: "first",
      start: { year: 2026, month: 2, day: 1 },
      end: { year: 2026, month: 2, day: 15 },
      payDate: { year: 2026, month: 2, day: 20 },
    },
    {
      key: "second",
      start: { year: 2026, month: 2, day: 16 },
      end: { year: 2026, month: 2, day: 28 },
      payDate: { year: 2026, month: 3, day: 5 },
    },
  ]);
  // December's second period pays in January
  assert.deepEqual(semiMonthlyPeriods(2026, 12)[1].payDate, { year: 2027, month: 1, day: 5 });
});

// ---- Payout config (HANDOFF §6.6) --------------------------------------------
test("payout config decides which paycheck a month's commission lands on", () => {
  const m = { year: 2026, month: 2 };
  assert.deepEqual(commissionPayoutDate("same_month_second", m), { year: 2026, month: 3, day: 5 });
  assert.deepEqual(commissionPayoutDate("next_month_first", m), { year: 2026, month: 3, day: 20 });
  assert.deepEqual(commissionPayoutDate("next_month_second", m), { year: 2026, month: 4, day: 5 });
});

// ---- Which invoices count (HANDOFF §6.6: sent or paid in the month) ----------
test("commission applies to invoices sent or paid in the month", () => {
  const m = { year: 2026, month: 3 };
  assert.equal(
    invoiceCountsForCommission({ status: "sent", sent_at: "2026-03-10", paid_at: null }, m),
    true,
  );
  assert.equal(
    invoiceCountsForCommission({ status: "paid", sent_at: "2026-02-10", paid_at: "2026-03-02" }, m),
    true, // paid in the month even though sent earlier
  );
  assert.equal(
    invoiceCountsForCommission({ status: "paid", sent_at: "2026-01-10", paid_at: "2026-01-20" }, m),
    false,
  );
  assert.equal(
    invoiceCountsForCommission({ status: "draft", sent_at: null, paid_at: null }, m),
    false,
  );
  assert.equal(
    invoiceCountsForCommission({ status: "void", sent_at: "2026-03-10", paid_at: null }, m),
    false,
  );
});

// ---- Total pay (HANDOFF §15: hours × base rate + commission, merged union) ---
test("total pay combines merged-union hours with the commission amount", () => {
  const hours = mergedMinutes([iv("2026-08-20T09:00", "2026-08-20T12:00")]) / 60; // 3h
  assert.equal(totalPay(hours, 30, 125.5), 3 * 30 + 125.5);
});
