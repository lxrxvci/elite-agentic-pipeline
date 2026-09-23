import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateQuote } from "../src/quote.ts";

/**
 * Jason regression suite (domain layer) - one test per bug Jason hit live in
 * the old system during the recorded walkthrough (2026-09-22). Each test is
 * named after his exact scenario so the mapping to his complaints is direct.
 */

// Scenario 1 (01:25:31): a $100/mo service with a $25 discount is $75/mo
// effective, and an 18-month retroactive stretch at that discounted rate
// totals $1,350. The old system priced the retroactive stretch at the
// UNDISCOUNTED rate ($1,800).
test("quote_discount_25_off_100_times_18_months_equals_1350", () => {
  const quote = calculateQuote({
    services: [
      { key: "bank_feed_management", discount: 25 }, // $100/mo - $25 = $75/mo
      { key: "retroactive_bookkeeping" },
    ],
    // Feb 2025 through Jul 2026 inclusive = 18 retroactive months (August is
    // worked live, never retroactively).
    retroactive: { startDate: "2025-02-01", currentMonth: { year: 2026, month: 8 } },
  });

  const line = quote.lines.find((l) => l.service_key === "bank_feed_management");
  assert.equal(line?.unit_price, 100);
  assert.equal(line?.discount, 25);

  // The discount drops the effective monthly rate to $75...
  assert.equal(quote.totals.effectiveMonthly, 75);

  // ...and the retroactive stretch prices at the DISCOUNTED rate: 75 x 18.
  assert.deepEqual(quote.retroactive, {
    months: 18,
    startMonth: { year: 2025, month: 2 },
    perMonthRate: 75,
    total: 1350,
  });
  const retroLine = quote.lines.find((l) => l.service_key === "retroactive_bookkeeping");
  assert.equal(retroLine?.unit_price, 75);
  assert.equal(retroLine?.quantity, 18);
  assert.equal(retroLine?.amount, 1350);
  // One-time money never feeds back into the effective monthly rate.
  assert.equal(quote.totals.totalOneTime, 1350);
  assert.equal(quote.totals.effectiveMonthly, 75);
});

// Scenario 1 bug class (the old system's negative-client-balance production
// bug): a discount must never push a line or a quote below zero - clamps at 0.
test("quote_discount_never_produces_negative_totals", () => {
  const quote = calculateQuote({
    services: [
      { key: "bank_feed_management", discount: 250 }, // exceeds the $100 line
      { key: "retroactive_bookkeeping" },
    ],
    retroactive: { startDate: "2026-01-01", currentMonth: { year: 2026, month: 8 } },
  });
  assert.equal(quote.totals.effectiveMonthly, 0); // clamped, never -150
  assert.equal(quote.totals.totalMonthly, 0);
  // No rate base -> the retroactive line stays unpriced rather than negative.
  assert.equal(quote.retroactive, null);

  // A partial discount plus an undiscounted service: only the discounted
  // line clamps; the rest of the quote prices normally.
  const mixed = calculateQuote({
    services: [
      { key: "bank_feed_management", discount: 150 }, // 100 - 150 -> 0
      { key: "invoicing" }, // $100/mo untouched
    ],
  });
  assert.equal(mixed.totals.effectiveMonthly, 100);
});
