import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRICING,
  QBO_TIER_SERVICE_KEY,
  billingCycleMonths,
  payrollPeriodsPerMonth,
  effectiveMonthly,
  calculateQuote,
  qboTierForServiceKey,
  recommendedQboTier,
} from "../src/quote.ts";

// ---- PRICING table (HANDOFF §15, ported verbatim) -----------------------------
test("the PRICING table carries ~30 service lines with the handoff's amounts", () => {
  assert.ok(Object.keys(PRICING).length >= 28);
  assert.equal(PRICING.qbo_setup.unit_price, 150);
  assert.equal(PRICING.initial_payroll_setup.unit_price, 150);
  assert.equal(PRICING.bank_feed_management.unit_price, 100);
  assert.equal(PRICING.account_reconciliations.unit_price, 25);
  assert.equal(PRICING.merchant_account_reconciliation.unit_price, 25);
  assert.equal(PRICING.loans_and_liabilities.unit_price, 25);
  assert.equal(PRICING.invoicing.unit_price, 100);
  assert.equal(PRICING.payment_processing.unit_price, 100);
  assert.equal(PRICING.record_bills.unit_price, 25);
  assert.equal(PRICING.monthly_reporting_5.unit_price, 100); // close tier: the 5th
  assert.equal(PRICING.monthly_reporting_10.unit_price, 50);
  assert.equal(PRICING.monthly_reporting_15.unit_price, 25);
  assert.equal(PRICING.quarterly_reporting.unit_price, 25);
  assert.equal(PRICING.semi_annual_reporting.unit_price, 25);
  assert.equal(PRICING.annual_reporting.unit_price, 25);
  assert.equal(PRICING.class_tracking.unit_price, 25);
  assert.equal(PRICING.location_tracking.unit_price, 25);
  assert.equal(PRICING["1099_collection"].unit_price, 50);
  assert.equal(PRICING["1099_full_management"].unit_price, 250);
  assert.equal(PRICING["1099_per_filing"].unit_price, 10);
  assert.equal(PRICING.payroll_quarterly_filings.unit_price, 45);
  assert.equal(PRICING.payroll_state_local_payments.unit_price, 25);
  assert.equal(PRICING.payroll_hours_commission_calculations.unit_price, 25);
  assert.equal(PRICING.payroll_corrections.unit_price, 150);
  assert.equal(PRICING.consulting_tier_1.unit_price, 150);
  assert.equal(PRICING.consulting_tier_2.unit_price, 100);
  assert.equal(PRICING.consulting_tier_3.unit_price, 75);
  assert.equal(PRICING.additional_therapist_tracking.unit_price, 100);
  assert.equal(PRICING.quickbooks_simple_start.unit_price, 30);
  assert.equal(PRICING.quickbooks_essentials.unit_price, 60);
  assert.equal(PRICING.quickbooks_plus.unit_price, 90);
  assert.equal(PRICING.quickbooks_advanced.unit_price, 200);
});

// ---- Billing cycle multiplier (HANDOFF §15) ------------------------------------
test("billing cycle derives from report frequency: quarterly 3, semi-annual 6, annual 12, else 1", () => {
  assert.equal(billingCycleMonths("quarterly"), 3);
  assert.equal(billingCycleMonths("semi_annual"), 6);
  assert.equal(billingCycleMonths("annual"), 12);
  assert.equal(billingCycleMonths("monthly"), 1);
  assert.equal(billingCycleMonths(undefined), 1);
});
test("payroll periods-per-month: weekly 52/12, biweekly 26/12, semi-monthly 2, monthly 1", () => {
  assert.equal(payrollPeriodsPerMonth("weekly"), 52 / 12);
  assert.equal(payrollPeriodsPerMonth("biweekly"), 26 / 12);
  assert.equal(payrollPeriodsPerMonth("semi_monthly"), 2);
  assert.equal(payrollPeriodsPerMonth("monthly"), 1);
});

// ---- effective_monthly formula (HANDOFF §15, verbatim) -------------------------
test("effective_monthly = monthly/cycle + quarterly/3 + annual-excl-Feb/12 + payroll/cycle", () => {
  const value = effectiveMonthly(
    {
      totalMonthly: 600,
      totalQuarterly: 45,
      annualExcludingFebruaryBilled: 120,
      totalPayrollMonthly: 90,
    },
    3,
  );
  assert.equal(value, 200 + 15 + 10 + 30); // 255
});

// ---- Quantity scaling inside calculate_quote (HANDOFF §15) ---------------------
test("flat monthly services get quantity = billing cycle months", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly",
    services: [{ key: "bank_feed_management" }],
  });
  const line = quote.lines.find((l) => l.service_key === "bank_feed_management");
  assert.equal(line?.quantity, 3);
  assert.equal(line?.amount, 300);
});
test("per-account services multiply the live account count by the cycle", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly",
    services: [{ key: "account_reconciliations", quantity: 4 }],
  });
  const line = quote.lines.find((l) => l.service_key === "account_reconciliations");
  assert.equal(line?.quantity, 12);
  assert.equal(line?.amount, 300);
});
test("payroll processing scales by periods-per-month times the cycle", () => {
  const quote = calculateQuote({
    reportFrequency: "monthly",
    payrollFrequency: "biweekly",
    services: [{ key: "process_payroll" }],
  });
  const line = quote.lines.find((l) => l.service_key === "process_payroll");
  assert.equal(line?.quantity, 26 / 12);
});
test("custom items scale by their own frequency", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly", // cycle 3
    customItems: [
      { key: "custom_item_1", product_name: "Weekly sweep", unit_price: 10, frequency: "weekly" },
      { key: "custom_item_2", product_name: "Daily sweep", unit_price: 5, frequency: "daily" },
      { key: "custom_item_3", product_name: "Quarterly sweep", unit_price: 90, frequency: "quarterly" },
      { key: "custom_item_4", product_name: "Semi sweep", unit_price: 120, frequency: "semi_annual" },
      { key: "custom_item_5", product_name: "Monthly sweep", unit_price: 40, frequency: "monthly" },
    ],
  });
  const qty = (k: string) => quote.lines.find((l) => l.service_key === k)?.quantity;
  assert.equal(qty("custom_item_1"), 12); // weekly × 4 per month × cycle
  assert.equal(qty("custom_item_2"), 66); // daily × 22 per month × cycle
  assert.equal(qty("custom_item_3"), 1); // quarterly × cycle/3
  assert.equal(qty("custom_item_4"), 0.5); // semi-annual × cycle/6
  assert.equal(qty("custom_item_5"), 3); // monthly × cycle
});
test("February-billed 1099 lines are excluded from the annual bucket", () => {
  const quote = calculateQuote({
    reportFrequency: "monthly",
    services: [
      { key: "1099_full_management" },
      { key: "account_reconciliations", quantity: 2 },
    ],
  });
  assert.equal(quote.totals.totalFebruaryBilledAnnual, 250);
  assert.equal(quote.totals.annualExcludingFebruaryBilled, 0);
  assert.equal(quote.totals.effectiveMonthly, 50); // (2 × $25) / cycle 1
});
test("a full quote mixes buckets into the effective monthly figure", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly", // cycle 3
    services: [
      { key: "bank_feed_management" }, // 3 × $100 = $300 monthly bucket
      { key: "account_reconciliations", quantity: 4 }, // 12 × $25 = $300 monthly bucket
      { key: "payroll_quarterly_filings" }, // 1 filing per quarter: $45 quarterly bucket
      { key: "payroll_state_local_payments" }, // 3 × $25 = $75 payroll-monthly bucket
    ],
  });
  assert.equal(quote.totals.totalMonthly, 600);
  assert.equal(quote.totals.totalQuarterly, 45);
  assert.equal(quote.totals.totalPayrollMonthly, 75);
  assert.equal(quote.totals.effectiveMonthly, 600 / 3 + 45 / 3 + 75 / 3); // 240
});
test("unknown service keys are rejected", () => {
  assert.throws(() => calculateQuote({ services: [{ key: "not_a_service" }] }), /unknown service key/i);
});

// ---- QBO tier recommendation (owner walkthrough matrix) --------------------
test("tier matrix: 1 user with no tracking needs Simple Start", () => {
  assert.equal(recommendedQboTier({ userCount: 1 }), "simple_start");
  assert.equal(recommendedQboTier({ userCount: null }), "simple_start"); // unknown seats: the owner alone
});
test("tier matrix: two or three users need at least Essentials", () => {
  assert.equal(recommendedQboTier({ userCount: 2 }), "essentials");
  assert.equal(recommendedQboTier({ userCount: 3 }), "essentials");
});
test("tier matrix: four or five users need Plus", () => {
  assert.equal(recommendedQboTier({ userCount: 4 }), "plus");
  assert.equal(recommendedQboTier({ userCount: 5 }), "plus");
});
test("tier matrix: more than five users need Advanced", () => {
  assert.equal(recommendedQboTier({ userCount: 6 }), "advanced");
});
test("tier matrix: class or location tracking floors the tier at Plus", () => {
  assert.equal(recommendedQboTier({ userCount: 1, classTracking: true }), "plus");
  assert.equal(recommendedQboTier({ userCount: 2, locationTracking: true }), "plus");
  // Tracking never LOWERS a seat-driven tier.
  assert.equal(recommendedQboTier({ userCount: 6, classTracking: true }), "advanced");
});
test("tier matrix: an explicit choice always wins", () => {
  assert.equal(recommendedQboTier({ userCount: 4, explicitTier: "essentials" }), "essentials");
  assert.equal(recommendedQboTier({ userCount: 1, classTracking: true, explicitTier: "advanced" }), "advanced");
});

test("a qbo input adds the recommended tier as a priced pass-through line", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }],
    qbo: { userCount: 2 },
  });
  assert.deepEqual(quote.qbo, { tier: "essentials", serviceKey: "quickbooks_essentials", recommended: true });
  const line = quote.lines.find((l) => l.service_key === "quickbooks_essentials");
  assert.equal(line?.unit_price, 60);
  assert.equal(line?.amount, 60); // monthly cycle
  assert.equal(quote.totals.effectiveMonthly, 160); // 100 + 60 pass-through
});
test("an explicit quickbooks_* service in the list is never duplicated or overridden", () => {
  const quote = calculateQuote({
    services: [{ key: "quickbooks_plus" }],
    qbo: { userCount: 1 },
  });
  assert.equal(quote.lines.filter((l) => l.service_key === "quickbooks_plus").length, 1);
  assert.deepEqual(quote.qbo, { tier: "plus", serviceKey: "quickbooks_plus", recommended: false });
});
test("an explicit tier pick prices the chosen plan, flagged not recommended", () => {
  const quote = calculateQuote({ qbo: { userCount: 2, explicitTier: "plus" } });
  assert.deepEqual(quote.qbo, { tier: "plus", serviceKey: "quickbooks_plus", recommended: false });
  assert.equal(quote.lines.find((l) => l.service_key === "quickbooks_plus")?.amount, 90);
});
test("qbo tier keys round-trip through the service-key lookup", () => {
  for (const [tier, key] of Object.entries(QBO_TIER_SERVICE_KEY)) {
    assert.equal(qboTierForServiceKey(key), tier);
  }
  assert.equal(qboTierForServiceKey("bank_feed_management"), null);
});

// ---- Priced retroactive bookkeeping (owner walkthrough) --------------------
test("retroactive work prices per elapsed month at the effective monthly rate", () => {
  const quote = calculateQuote({
    services: [
      { key: "bank_feed_management" }, // $100/mo, cycle 1 -> effective monthly 100
      { key: "retroactive_bookkeeping" },
    ],
    retroactive: { startDate: "2026-01-01", currentMonth: { year: 2026, month: 8 } },
  });
  assert.deepEqual(quote.retroactive, {
    months: 7, // Jan through Jul; August is worked live
    startMonth: { year: 2026, month: 1 },
    perMonthRate: 100,
    total: 700,
  });
  const line = quote.lines.find((l) => l.service_key === "retroactive_bookkeeping");
  assert.equal(line?.unpriced, false);
  assert.equal(line?.quantity, 7);
  assert.equal(line?.unit_price, 100);
  assert.equal(line?.amount, 700);
  // One-time money: into totalOneTime, never into the effective monthly rate.
  assert.equal(quote.totals.totalOneTime, 700);
  assert.equal(quote.totals.effectiveMonthly, 100);
});
test("the retroactive per-month rate follows the WHOLE quote's effective monthly", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly", // cycle 3
    services: [
      { key: "bank_feed_management" }, // 3 x $100 = $300 monthly bucket
      { key: "payroll_quarterly_filings" }, // $45 quarterly bucket
      { key: "retroactive_bookkeeping" },
    ],
    retroactive: { startDate: "2025-10-01", currentMonth: { year: 2026, month: 3 } },
  });
  // effectiveMonthly = 300/3 + 45/3 = 115; months Oct..Feb = 5.
  assert.equal(quote.retroactive?.perMonthRate, 115);
  assert.equal(quote.retroactive?.months, 5);
  assert.equal(quote.retroactive?.total, 575);
  assert.equal(quote.totals.effectiveMonthly, 115); // unchanged by the retro line
});
test("retroactive stays 'quoted at review' without a scope or a rate base", () => {
  const noScope = calculateQuote({ services: [{ key: "retroactive_bookkeeping" }] });
  assert.equal(noScope.lines.find((l) => l.service_key === "retroactive_bookkeeping")?.unpriced, true);
  assert.equal(noScope.retroactive, null);

  const noRate = calculateQuote({
    services: [{ key: "retroactive_bookkeeping" }],
    retroactive: { startDate: "2026-01-01", currentMonth: { year: 2026, month: 8 } },
  });
  assert.equal(noRate.lines.find((l) => l.service_key === "retroactive_bookkeeping")?.unpriced, true);
  assert.equal(noRate.retroactive, null);
});
test("a start date in the current month means zero retroactive months", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }, { key: "retroactive_bookkeeping" }],
    retroactive: { startDate: "2026-08-01", currentMonth: { year: 2026, month: 8 } },
  });
  assert.equal(quote.retroactive?.months, 0);
  assert.equal(quote.retroactive?.total, 0);
});
