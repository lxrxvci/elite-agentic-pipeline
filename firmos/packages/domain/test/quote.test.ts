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
    baseTotal: 700,
    discountPercent: null,
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

// ---- Specialty reports (C10: priced into the quote, retro missed filings) ----
test("specialty reports price hours x the default rate at their own cadence", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }], // $100/mo base
    specialtyReports: [
      // The walkthrough figure: a 3-hour specialty report at $150/hr = $450/mo.
      { name: "Owner Draw Analysis", frequency: "monthly", estimatedHours: 3 },
      // Quarterly cadence on a monthly-billed client: $300/quarter = $100/mo.
      { name: "Oregon CAT", frequency: "quarterly", flatPrice: 300 },
    ],
  });
  const monthly = quote.lines.find((l) => l.service_key === "specialty_report_1");
  assert.equal(monthly?.unit_price, 450);
  assert.equal(monthly?.quantity, 1); // cycle 1 / 1 month
  assert.equal(monthly?.amount, 450);
  assert.equal(monthly?.bucket, "monthly");
  const quarterly = quote.lines.find((l) => l.service_key === "specialty_report_2");
  assert.equal(quarterly?.unit_price, 300);
  assert.equal(quarterly?.quantity, 1 / 3); // one report per quarter, spread monthly
  assert.equal(quarterly?.amount, 100);
  // 100 (bank feeds) + 450 + 100.
  assert.equal(quote.totals.effectiveMonthly, 650);
});

test("specialty report frequency is independent of the client's billing cycle", () => {
  const quote = calculateQuote({
    reportFrequency: "quarterly", // cycle 3
    services: [{ key: "bank_feed_management" }], // 3 x $100
    specialtyReports: [
      { name: "Annual Filing", frequency: "annual", flatPrice: 1200 },
      { name: "Monthly KPI", frequency: "monthly", estimatedHours: 2 }, // $300/mo
    ],
  });
  const annual = quote.lines.find((l) => l.service_key === "specialty_report_1");
  assert.equal(annual?.quantity, 3 / 12); // cycle months / 12
  assert.equal(annual?.amount, 300); // $1,200/yr normalized into the quarter
  const monthly = quote.lines.find((l) => l.service_key === "specialty_report_2");
  assert.equal(monthly?.quantity, 3);
  assert.equal(monthly?.amount, 900);
  // effectiveMonthly = (300 + 300 + 900) / 3 = 500.
  assert.equal(quote.totals.effectiveMonthly, 500);
});

test("missed past filings add one-time retro lines at the per-report price (C10)", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }],
    specialtyReports: [
      // The walkthrough scenario: 18 unfiled Oregon reports.
      { name: "Oregon Special Report", frequency: "annual", flatPrice: 200, missedFilings: 18 },
    ],
  });
  const retro = quote.lines.find((l) => l.service_key === "specialty_report_1_retro");
  assert.equal(retro?.product_name, "Missed past filings: Oregon Special Report");
  assert.equal(retro?.quantity, 18);
  assert.equal(retro?.unit_price, 200);
  assert.equal(retro?.amount, 3600);
  assert.equal(retro?.bucket, "one_time");
  // One-time money lands in totalOneTime and never inflates the monthly rate.
  assert.equal(quote.totals.totalOneTime, 3600);
  // 200/12 rounds to 16.67 at the line (per-line round2 convention).
  assert.equal(quote.totals.effectiveMonthly, 116.67);
});

test("a specialty report with no hours and no price stays unpriced, never guessed", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }],
    specialtyReports: [{ name: "Mystery Report", frequency: "monthly", missedFilings: 4 }],
  });
  const line = quote.lines.find((l) => l.service_key === "specialty_report_1");
  assert.equal(line?.unpriced, true);
  assert.equal(line?.amount, null);
  const retro = quote.lines.find((l) => l.service_key === "specialty_report_1_retro");
  assert.equal(retro?.unpriced, true);
  assert.equal(retro?.amount, null);
  assert.equal(quote.totals.effectiveMonthly, 100);
  assert.equal(quote.totals.totalOneTime, 0);
});

test("no specialty reports -> no specialty lines (existing quotes unchanged)", () => {
  const quote = calculateQuote({ services: [{ key: "bank_feed_management" }] });
  assert.equal(quote.lines.some((l) => l.service_key.startsWith("specialty_report_")), false);
});

// ---- J4 (V4): direct per-line price overrides (servicePrices) ----------------
test("price_edit_replaces_discount_flow: an override replaces the line amount and wins over a discount", () => {
  const quote = calculateQuote({
    services: [
      { key: "bank_feed_management" }, // $100/mo
      { key: "account_reconciliations", quantity: 5, discount: 25 }, // 5 x $25 - $25 = $100
    ],
    servicePrices: { account_reconciliations: 80 },
  });
  const recon = quote.lines.find((l) => l.service_key === "account_reconciliations");
  assert.equal(recon?.price_override, 80);
  // The override wins outright - the legacy $25 discount no longer nets.
  assert.equal(quote.totals.totalMonthly, 100 + 80);
  assert.equal(quote.totals.effectiveMonthly, 180);
});

test("an override clamps at zero and follows the line's bucket", () => {
  const quote = calculateQuote({
    services: [
      { key: "bank_feed_management" },
      { key: "qbo_setup" },
      { key: "payroll_quarterly_filings" },
    ],
    servicePrices: { bank_feed_management: 0, qbo_setup: 99, payroll_quarterly_filings: 60 },
  });
  assert.equal(quote.totals.totalMonthly, 0); // clamped, never negative
  assert.equal(quote.totals.totalOneTime, 99);
  assert.equal(quote.totals.totalQuarterly, 60);
  assert.equal(quote.totals.effectiveMonthly, 60 / 3);
});

test("an override prices even an unpriced line (quoted at review, set at review)", () => {
  const quote = calculateQuote({
    services: [{ key: "process_payroll" }], // §15 states no amount
    servicePrices: { process_payroll: 200 },
  });
  const line = quote.lines.find((l) => l.service_key === "process_payroll");
  assert.equal(line?.unpriced, true); // the STANDARD price is still unstated
  assert.equal(line?.price_override, 200);
  assert.equal(quote.totals.totalPayrollMonthly, 200);
  assert.equal(quote.totals.effectiveMonthly, 200);
});

test("legacy stored discounts price identically when no override exists (no regression)", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management", discount: 25 }],
  });
  const line = quote.lines.find((l) => l.service_key === "bank_feed_management");
  assert.equal(line?.price_override, undefined);
  assert.equal(quote.totals.totalMonthly, 75);
  assert.equal(quote.totals.effectiveMonthly, 75);
});

test("the override reaches every line kind by key (QBO pass-through, custom, specialty)", () => {
  const quote = calculateQuote({
    services: [{ key: "bank_feed_management" }],
    qbo: { userCount: 2 }, // recommends Essentials ($60/mo pass-through)
    customItems: [{ key: "custom_item_1", product_name: "Cleanup crew", unit_price: 50, frequency: "weekly" }],
    specialtyReports: [{ name: "KPI pack", frequency: "monthly", flatPrice: 300 }],
    servicePrices: { quickbooks_essentials: 55, custom_item_1: 160, specialty_report_1: 250 },
  });
  assert.equal(quote.lines.find((l) => l.service_key === "quickbooks_essentials")?.price_override, 55);
  assert.equal(quote.lines.find((l) => l.service_key === "custom_item_1")?.price_override, 160);
  assert.equal(quote.lines.find((l) => l.service_key === "specialty_report_1")?.price_override, 250);
  // Monthly bucket: 100 + 55 + 160 + 250.
  assert.equal(quote.totals.totalMonthly, 565);
});

test("a retro-line override prices the whole cleanup flat, never double counted", () => {
  const base = {
    reportFrequency: "monthly",
    services: [{ key: "bank_feed_management" }, { key: "retroactive_bookkeeping" }],
    retroactive: { startDate: "2026-01-01", currentMonth: { year: 2026, month: 8 } },
  };
  const standard = calculateQuote(base);
  assert.equal(standard.retroactive?.total, 700); // 7 months x $100/mo
  assert.equal(standard.totals.totalOneTime, 700);

  const overridden = calculateQuote({ ...base, servicePrices: { retroactive_bookkeeping: 500 } });
  assert.equal(overridden.retroactive?.total, 500); // flat, not 7 x $100
  assert.equal(overridden.totals.totalOneTime, 500); // once, never twice
  // The derived months x rate stays on the line for display.
  const line = overridden.lines.find((l) => l.service_key === "retroactive_bookkeeping");
  assert.equal(line?.quantity, 7);
  assert.equal(line?.unit_price, 100);
  assert.equal(line?.amount, 500);
});
