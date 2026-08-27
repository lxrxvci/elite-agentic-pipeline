import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRICING,
  calculateQuote,
  mergedPricing,
  type PricingOverrides,
} from "../src/quote.ts";
import { COMMISSION_TIERS, COMMISSION_FLOOR_RATE, commissionRate } from "../src/commission.ts";

/**
 * Admin-configurable pricing and commission tiers (owner call notes): the
 * domain stays pure - overrides/tiers arrive as parameters and the default
 * constants are untouched, so the no-override path is byte-identical.
 */

// ---- mergedPricing ------------------------------------------------------------

test("mergedPricing with no overrides returns the PRICING table itself", () => {
  assert.equal(mergedPricing(), PRICING);
  assert.equal(mergedPricing(null), PRICING);
  assert.equal(mergedPricing({}), PRICING);
});

test("mergedPricing overrides win per key; every other entry is untouched", () => {
  const merged = mergedPricing({ bank_feed_management: 120, quickbooks_plus: 99.5 });
  assert.equal(merged.bank_feed_management.unit_price, 120);
  assert.equal(merged.quickbooks_plus.unit_price, 99.5);
  assert.equal(merged.account_reconciliations.unit_price, 25);
  // The defaults themselves never mutate.
  assert.equal(PRICING.bank_feed_management.unit_price, 100);
  assert.equal(PRICING.quickbooks_plus.unit_price, 90);
});

test("mergedPricing ignores null/undefined entries and unknown keys", () => {
  const merged = mergedPricing({
    bank_feed_management: null,
    monthly_reporting_10: undefined,
    not_a_service: 500,
  });
  assert.equal(merged, PRICING);
});

test("an override can price a service the handoff leaves unpriced", () => {
  const merged = mergedPricing({ process_payroll: 40 });
  assert.equal(merged.process_payroll.unit_price, 40);
  assert.equal(PRICING.process_payroll.unit_price, null);
});

// ---- calculateQuote with overrides ---------------------------------------------

test("calculateQuote with overrides changes the affected lines and totals only", () => {
  const input = {
    reportFrequency: "monthly",
    services: [
      { key: "bank_feed_management" },
      { key: "account_reconciliations", quantity: 3 },
    ],
  };
  const base = calculateQuote(input);
  const overridden = calculateQuote(input, { bank_feed_management: 120 });

  assert.equal(base.totals.effectiveMonthly, 100 + 75);
  assert.equal(overridden.totals.effectiveMonthly, 120 + 75);
  const feed = overridden.lines.find((l) => l.service_key === "bank_feed_management")!;
  assert.equal(feed.unit_price, 120);
  assert.equal(feed.amount, 120);
  const recon = overridden.lines.find((l) => l.service_key === "account_reconciliations")!;
  assert.equal(recon.unit_price, 25);
});

test("calculateQuote overrides apply to the QBO pass-through line", () => {
  const quote = calculateQuote(
    { services: [{ key: "bank_feed_management" }], qbo: { userCount: 1 } },
    { quickbooks_simple_start: 35 },
  );
  const qbo = quote.lines.find((l) => l.service_key === "quickbooks_simple_start")!;
  assert.equal(qbo.unit_price, 35);
  assert.equal(qbo.amount, 35);
  assert.equal(quote.totals.effectiveMonthly, 100 + 35);
});

test("calculateQuote with an empty override map matches the default quote exactly", () => {
  const input = {
    reportFrequency: "quarterly",
    payrollFrequency: "weekly" as const,
    services: [
      { key: "bank_feed_management" },
      { key: "monthly_reporting_5" },
      { key: "process_payroll" },
      { key: "1099_per_filing", quantity: 4 },
    ],
    qbo: { userCount: 6 },
  };
  assert.deepEqual(calculateQuote(input, {}), calculateQuote(input));
});

test("an override prices a previously unpriced service line", () => {
  const input = {
    services: [{ key: "process_payroll" }],
    payrollFrequency: "semi_monthly" as const,
  };
  const unpriced = calculateQuote(input);
  assert.equal(unpriced.lines[0]!.unpriced, true);
  assert.equal(unpriced.lines[0]!.amount, null);

  const priced = calculateQuote(input, { process_payroll: 40 });
  assert.equal(priced.lines[0]!.unpriced, false);
  assert.equal(priced.lines[0]!.quantity, 2); // semi-monthly: 2 periods x cycle 1
  assert.equal(priced.lines[0]!.amount, 80);
  assert.equal(priced.totals.effectiveMonthly, 80);
});

test("null override entries fall back to the default price", () => {
  const input = { services: [{ key: "bank_feed_management" }] };
  const quote = calculateQuote(input, { bank_feed_management: null } satisfies PricingOverrides);
  assert.equal(quote.lines[0]!.unit_price, 100);
});

// ---- commissionRate with custom tier tables ------------------------------------

test("commissionRate without a tiers argument uses the HANDOFF table unchanged", () => {
  assert.equal(commissionRate(100), 50);
  assert.equal(commissionRate(95), 45);
  assert.equal(commissionRate(50), 35);
  assert.equal(commissionRate(null), COMMISSION_FLOOR_RATE);
  assert.deepEqual([...COMMISSION_TIERS], [
    { minOnTimePercent: 100, rate: 50 },
    { minOnTimePercent: 90, rate: 45 },
    { minOnTimePercent: 80, rate: 40 },
    { minOnTimePercent: 0, rate: 35 },
  ]);
});

test("a custom tier table replaces the defaults (owner's 99% -> 45% example)", () => {
  const tiers = [
    { minOnTimePercent: 99, rate: 45 },
    { minOnTimePercent: 90, rate: 40 },
    { minOnTimePercent: 0, rate: 35 },
  ];
  assert.equal(commissionRate(99, null, tiers), 45);
  assert.equal(commissionRate(100, null, tiers), 45); // 100 has no own tier now
  assert.equal(commissionRate(98.9, null, tiers), 40);
  assert.equal(commissionRate(90, null, tiers), 40);
  assert.equal(commissionRate(89.9, null, tiers), 35);
});

test("custom tiers match highest-threshold-first regardless of input order", () => {
  const tiers = [
    { minOnTimePercent: 0, rate: 35 },
    { minOnTimePercent: 99, rate: 45 },
    { minOnTimePercent: 90, rate: 40 },
  ];
  assert.equal(commissionRate(99.5, null, tiers), 45);
  assert.equal(commissionRate(95, null, tiers), 40);
  assert.equal(commissionRate(10, null, tiers), 35);
});

test("below the lowest custom threshold the floor rate still applies", () => {
  const tiers = [{ minOnTimePercent: 80, rate: 40 }];
  assert.equal(commissionRate(80, null, tiers), 40);
  assert.equal(commissionRate(79.9, null, tiers), COMMISSION_FLOOR_RATE);
  assert.equal(commissionRate(null, null, tiers), COMMISSION_FLOOR_RATE);
});

test("a per-user override still bypasses custom tiers entirely", () => {
  const tiers = [{ minOnTimePercent: 0, rate: 60 }];
  assert.equal(commissionRate(100, 42, tiers), 42);
  assert.equal(commissionRate(null, 42, tiers), 42);
});

test("tier boundary: the threshold itself earns the tier", () => {
  const tiers = [
    { minOnTimePercent: 95, rate: 48 },
    { minOnTimePercent: 0, rate: 36 },
  ];
  assert.equal(commissionRate(95, null, tiers), 48);
  assert.equal(commissionRate(94.99, null, tiers), 36);
});
