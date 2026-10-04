import { beforeAll, describe, expect, it } from "vitest";

import { PRICING, recommendedQboTier } from "@firmos/domain";

import { db } from "@/db";
import { onboardingTemplateTasks } from "@/db/schema";
import { listInstitutions } from "@/server/institutions";
import { listMerchantProcessors } from "@/server/merchant-processors";
import { listPayrollProviders } from "@/server/payroll-providers";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * The Jason harness (meeting-0930 plan K0) - the standing rules Jason has
 * dictated across four calls, encoded as permanent pins so no future wave
 * silently breaks one (Matthew keeps this list; 09_30 00:23:52 "it literally
 * says alphabetized").
 *
 * Two kinds of entries:
 *  - ACTIVE tests for rules that are true today (they must never regress).
 *  - it.todo markers for rules whose wave hasn't landed yet; each K-wave
 *    flips its marker into a live test (component-level rules get their live
 *    test colocated with the component; the todo stays here as the index).
 *
 * Already pinned elsewhere (referenced, not duplicated):
 *  - J11 phone mask + text dates: intake screens suites (I1).
 *  - J12 one-catch-up-project-per-tax-year: jason-regression.test.ts.
 *  - J14 unpriced-never-guessed: pricing-config / quote suites.
 */

describe("jason harness - pricing canon (Intake Template rate card vs PRICING)", () => {
  it("pricing_canon_matches_template_rate_card", () => {
    // One-time
    expect(PRICING.qbo_setup.unit_price).toBe(150); // r12
    expect(PRICING.initial_payroll_setup.unit_price).toBe(150);
    // Core monthly
    expect(PRICING.bank_feed_management.unit_price).toBe(100); // r14 min
    expect(PRICING.account_reconciliations.unit_price).toBe(25); // r15 per account
    expect(PRICING.merchant_account_reconciliation.unit_price).toBe(25); // r16
    expect(PRICING.loans_and_liabilities.unit_price).toBe(25); // r18 floor ($25-50)
    expect(PRICING.invoicing.unit_price).toBe(100); // r22
    expect(PRICING.record_bills.unit_price).toBe(25);
    // Reporting tiers - 5th highest, 10th mid, 15th lowest (r17)
    expect(PRICING.monthly_reporting_5.unit_price).toBe(100);
    expect(PRICING.monthly_reporting_10.unit_price).toBe(50);
    expect(PRICING.monthly_reporting_15.unit_price).toBe(25);
    expect(PRICING.quarterly_reporting.unit_price).toBe(25);
    expect(PRICING.annual_reporting.unit_price).toBe(25);
    // Tracking
    expect(PRICING.class_tracking.unit_price).toBe(25); // r25 per class
    expect(PRICING.location_tracking.unit_price).toBe(25); // r26 per location
    expect(PRICING.additional_therapist_tracking.unit_price).toBe(100); // r25 therapist niche
    // 1099 (r21): $50 collection / $250 managed / $10 per filing - the $270
    // demo figure was a client price, not the rate card.
    expect(PRICING["1099_collection"].unit_price).toBe(50);
    expect(PRICING["1099_full_management"].unit_price).toBe(250);
    expect(PRICING["1099_per_filing"].unit_price).toBe(10);
    // Payroll (r33-35)
    expect(PRICING.payroll_state_local_payments.unit_price).toBe(25);
    expect(PRICING.payroll_hours_commission_calculations.unit_price).toBe(25);
    // OPEN CONFLICT (FIRMOS-PRICING-CANON.md): template r33 says
    // $25/quarter, HANDOFF §15 ported $45/quarter. Jason confirms; admin
    // pricing override resolves either way without a code change.
    expect(PRICING.payroll_quarterly_filings.unit_price).toBe(45);
    // QBO pass-throughs (r28-31; admin-editable, live pull deferred)
    expect(PRICING.quickbooks_simple_start.unit_price).toBe(30);
    expect(PRICING.quickbooks_essentials.unit_price).toBe(60);
    expect(PRICING.quickbooks_plus.unit_price).toBe(90);
    expect(PRICING.quickbooks_advanced.unit_price).toBe(200);
    // Unpriced-never-guessed (J14): named-but-unamounted services stay null.
    expect(PRICING.process_payroll.unit_price).toBeNull();
    expect(PRICING.specialty_reports.unit_price).toBeNull();
    expect(PRICING.retroactive_bookkeeping.unit_price).toBeNull();
  });

  it.todo("payroll_quarterly_filings_canon_confirmed - Jason picks $25 (template r33) or $45 (HANDOFF §15)");

  it("qbo_tier_matrix_matches_owner_rule (V2)", () => {
    // Owner walkthrough matrix: seats 1 -> Simple Start, 2-3 -> Essentials,
    // 4-5 -> Plus, 6+ -> Advanced; class OR location tracking floors at
    // Plus; an explicit pick always wins.
    expect(recommendedQboTier({ userCount: 1 })).toBe("simple_start");
    expect(recommendedQboTier({ userCount: 2 })).toBe("essentials");
    expect(recommendedQboTier({ userCount: 3 })).toBe("essentials");
    expect(recommendedQboTier({ userCount: 4 })).toBe("plus");
    expect(recommendedQboTier({ userCount: 5 })).toBe("plus");
    expect(recommendedQboTier({ userCount: 6 })).toBe("advanced");
    expect(recommendedQboTier({ userCount: 1, classTracking: true })).toBe("plus");
    expect(recommendedQboTier({ userCount: 2, locationTracking: true })).toBe("plus");
    expect(recommendedQboTier({ userCount: 1, explicitTier: "advanced" })).toBe("advanced");
    expect(recommendedQboTier({ userCount: null })).toBe("simple_start");
  });
});

const reachable = await dbReachable();

describe.skipIf(!reachable)("jason harness - database rules", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("J3: every DB-backed option list returns alphabetized", async () => {
    for (const names of [
      (await listInstitutions()).map((r) => r.name),
      (await listPayrollProviders()).map((r) => r.name),
      (await listMerchantProcessors()).map((r) => r.name),
    ]) {
      // Human alphabetization (Jason's rule): case-insensitive, "Umpqua"
      // before "US Bank" - matching the DB's locale collation order.
      const human = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      expect([...names]).toEqual(human);
    }
  });

  it("V4: onboarding template holds the content rules", async () => {
    const rows = await db.select().from(onboardingTemplateTasks);
    const titles = rows.map((r) => r.title.toLowerCase());

    // Engagement-letter tasks exist in the admin phase.
    expect(titles.some((t) => t.includes("engagement letter"))).toBe(true);
    // A46: a task prompts vault completion.
    expect(titles.some((t) => t.includes("vault"))).toBe(true);
    // "Set up recurring invoice" is automatic, NEVER a checklist item.
    expect(titles.some((t) => t.includes("recurring invoice"))).toBe(false);
    // No feed-sync tasks for accounts without online access.
    const connect = rows.find((r) => r.title.toLowerCase().includes("bank feeds"));
    expect(connect?.requiresOnlineAccounts).toBe(true);
    // QBO setup/verify exists exactly once (the create-before-grant order
    // rule is moot while there is a single QBO task).
    expect(titles.filter((t) => t.includes("quickbooks"))).toHaveLength(1);
  });
});

// The K-wave index closed out (K0-K7 all landed). This file keeps the live
// canon pins above; new standing rules get their own named test here.

describe("jason harness - K6 pins", () => {
  it("retro_bulk_discount_applies: 20% off the cleanup block discounts the retro total only", async () => {
    const { calculateIntakeQuote } = await import("@/server/quote");
    const base = {
      engagementType: "bookkeeping",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      serviceKeys: ["bank_feed_management", "retroactive_bookkeeping"],
    } as Parameters<typeof calculateIntakeQuote>[0];
    const full = calculateIntakeQuote(base, TEST_TODAY);
    const discounted = calculateIntakeQuote({ ...base, retroDiscountPercent: 20 }, TEST_TODAY);
    const retro = discounted.retroactive!;
    expect(retro.discountPercent).toBe(20);
    expect(retro.total).toBeCloseTo(retro.baseTotal * 0.8, 2);
    // The recurring rate is untouched - the discount never bleeds monthly.
    expect(discounted.totals.effectiveMonthly).toBe(full.totals.effectiveMonthly);
    expect(discounted.totals.totalOneTime).toBeLessThan(full.totals.totalOneTime);
  });

  it("J13: weekly_100_shows_400_monthly - a custom weekly line shows the monthly math", async () => {
    const { buildBucketedEstimate } = await import("@/components/intake/review-estimate");
    const { calculateIntakeQuote } = await import("@/server/quote");
    const quote = calculateIntakeQuote(
      {
        engagementType: "bookkeeping",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "10",
        bookkeepingStartDate: "2026-08-01",
        serviceKeys: [],
        customItems: [{ productName: "Weekly bank deposits", unitPrice: 100, frequency: "weekly" }],
      } as Parameters<typeof calculateIntakeQuote>[0],
      TEST_TODAY,
    );
    const estimate = buildBucketedEstimate(quote, {
      engagementType: "bookkeeping",
      customItems: [{ productName: "Weekly bank deposits", unitPrice: 100, frequency: "weekly" }],
    } as never);
    const line = estimate.groups.flatMap((g) => g.lines).find((l) => l.name === "Weekly bank deposits");
    expect(line?.math).toBe("$100/week × 4 weeks = $400/mo");
    expect(line?.perMonth).toBe(400);
  });
});
