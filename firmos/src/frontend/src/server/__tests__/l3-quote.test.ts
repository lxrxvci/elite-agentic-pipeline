import { describe, expect, it } from "vitest";

import { buildRecurringServicesTemplate, calculateIntakeQuote, specialtyReportsFromIntake } from "@/server/quote";

import { TEST_TODAY } from "./helpers";

/**
 * L3 (10_06): a tier-priced specialty report flows from the intake fields
 * into a priced quote line flagged pricedByTiers (the caveat), and the
 * conversion template carries the tier-estimate note (F6).
 */

const BASE = {
  legalName: "Tier Co",
  engagementType: "bookkeeping",
  bookkeepingFrequency: "monthly",
  monthlyCloseTier: "10",
  bookkeepingStartDate: "2026-08-01",
  serviceKeys: [],
} as Parameters<typeof calculateIntakeQuote>[0];

describe("L3: tier-priced reports flow into the quote + template", () => {
  it("the intake's tier fields price the line at the tier sum, flagged pricedByTiers", () => {
    const quote = calculateIntakeQuote(
      {
        ...BASE,
        reportDefinitions: [
          {
            name: "Oregon Special Report",
            frequency: "annual",
            pricingMode: "hours",
            tierHours: { bookkeeper: 2, manager: 1, owner: 0.5 },
          },
        ],
      },
      TEST_TODAY,
    );
    const line = quote.lines.find((l) => l.service_key === "specialty_report_1");
    expect(line).toBeTruthy();
    // 2x75 + 1x100 + 0.5x150 = 325/yr; monthly bucket normalizes to the cycle.
    expect(line!.unit_price).toBe(325);
    expect(line!.pricedByTiers).toBe(true);
    expect(line!.unpriced).toBe(false);
  });

  it("the conversion template line carries the tier-estimate note (F6)", () => {
    const quote = calculateIntakeQuote(
      {
        ...BASE,
        reportDefinitions: [
          {
            name: "Oregon Special Report",
            frequency: "annual",
            pricingMode: "hours",
            tierHours: { bookkeeper: 2, manager: 1, owner: 0.5 },
          },
        ],
      },
      TEST_TODAY,
    );
    const inputs = specialtyReportsFromIntake(
      {
        reportDefinitions: [
          {
            name: "Oregon Special Report",
            frequency: "annual",
            pricingMode: "hours",
            tierHours: { bookkeeper: 2, manager: 1, owner: 0.5 },
          },
        ],
      },
      TEST_TODAY,
    );
    expect(inputs[0]?.tierHours).toEqual({ bookkeeper: 2, manager: 1, owner: 0.5 });

    const template = buildRecurringServicesTemplate(quote, [], inputs);
    const line = template.find((l) => l.service_key === "specialty_report_1");
    expect(line?.notes).toContain("Difficulty-tier estimate");
    expect(line?.notes).toContain("actual billing rate applies at invoicing");
  });

  it("flat-mode reports price flat and carry no tier flag", () => {
    const quote = calculateIntakeQuote(
      {
        ...BASE,
        reportDefinitions: [{ name: "Flat Report", frequency: "annual", pricingMode: "flat", flatPrice: 450 }],
      },
      TEST_TODAY,
    );
    const line = quote.lines.find((l) => l.service_key === "specialty_report_1");
    expect(line!.unit_price).toBe(450);
    expect(line!.pricedByTiers).toBeUndefined();
  });
});

describe("L4/G7: account_factor_editor_reprices_live (10_06 01:16:53)", () => {
  const RECON_BASE = {
    legalName: "Factor Co",
    engagementType: "bookkeeping",
    bookkeepingFrequency: "monthly",
    monthlyCloseTier: "10",
    bookkeepingStartDate: "2026-08-01",
    serviceKeys: ["account_reconciliations"],
    accounts: [
      { name: "Chase Checking · 4411", accountType: "checking", proofCategory: "statement", institution: "Chase", last4: "4411", statementDay: 10 },
      { name: "Chase Checking · 2200", accountType: "checking", proofCategory: "statement", institution: "Chase", last4: "2200", statementDay: 10 },
      { name: "Chase Savings · 1005", accountType: "savings", proofCategory: "statement", institution: "Chase", last4: "1005", statementDay: 10 },
      { name: "Amex Credit card · 7007", accountType: "credit_card", proofCategory: "statement", institution: "Amex", last4: "7007", statementDay: 10 },
    ],
  } as unknown as Parameters<typeof calculateIntakeQuote>[0];

  it("excluding an account drops the recon quantity and the price follows", () => {
    const full = calculateIntakeQuote(RECON_BASE, TEST_TODAY);
    const fullLine = full.lines.find((l) => l.service_key === "account_reconciliations");
    expect(fullLine!.quantity).toBe(4);
    expect(fullLine!.amount).toBe(100); // 4 x $25

    const excluded = calculateIntakeQuote(
      { ...RECON_BASE, reconExcludedAccounts: ["Chase Checking · 2200"] },
      TEST_TODAY,
    );
    const line = excluded.lines.find((l) => l.service_key === "account_reconciliations");
    expect(line!.quantity).toBe(3);
    expect(line!.amount).toBe(75); // 3 x $25 - the factor edit repriced the line
  });
});

describe("L4/G8: friday_count_changes_october_vs_september_billing (10_06 01:04:50)", () => {
  it("a weekly custom rule's template line carries its weekday schedule (the invoice engine bills real occurrence counts)", () => {
    const quote = calculateIntakeQuote(
      {
        ...BASE,
        customRecurringRules: [
          { title: "Friday deposit run", scheduleType: "weekly", daysOfWeek: "5", isBillable: true, unitPrice: 100, subtasks: [] },
        ],
      },
      TEST_TODAY,
    );
    const template = buildRecurringServicesTemplate(
      quote,
      [],
      [],
      [{ title: "Friday deposit run", scheduleType: "weekly", daysOfWeek: "5", isBillable: true, unitPrice: 100, subtasks: [] }],
    );
    const line = template.find((l) => l.service_key === "custom_rule_1");
    expect(line).toBeTruthy();
    expect(line!.frequency).toBe("weekly");
    expect(line!.days_of_week).toBe("5");
  });

  it("the invoice engine bills October's 5 Fridays vs September's 4", async () => {
    const { recurringBillingQuantityForMonth } = await import("@firmos/domain");
    const shape = { schedule_type: "weekly", days_of_week: "5", day_of_month: null, weekday: null, week_of_month: null, anchor_month: null, next_run: "2026-09-01" };
    // September 2026 has 4 Fridays; October 2026 has 5.
    expect(recurringBillingQuantityForMonth(shape, 2026, 9)).toBe(4);
    expect(recurringBillingQuantityForMonth({ ...shape, next_run: "2026-10-01" }, 2026, 10)).toBe(5);
  });
});

describe("L4/G9: annual_line_assigned_to_january - the template carries bill_month (10_06 01:21:18)", () => {
  it("an annual report assigned to January stamps bill_month; unassigned lines carry none", () => {
    const reportDefinitions = [
      { name: "Oregon Special Report", frequency: "annual", pricingMode: "flat", flatPrice: 225 },
    ] as const;
    const quote = calculateIntakeQuote(
      { ...BASE, reportDefinitions: [...reportDefinitions] },
      TEST_TODAY,
    );
    const inputs = specialtyReportsFromIntake({ reportDefinitions: [...reportDefinitions] }, TEST_TODAY);
    const template = buildRecurringServicesTemplate(
      quote,
      [],
      inputs,
      [],
      // The estimate's billing-month drop-down picked January for the report.
      { specialty_report_1: 1 },
    );
    const line = template.find((l) => l.service_key === "specialty_report_1");
    expect(line).toMatchObject({ frequency: "annual", bill_month: 1 });
    // Every unassigned line carries no bill_month at all.
    expect(template.filter((l) => l.service_key !== "specialty_report_1").every((l) => l.bill_month == null)).toBe(true);
  });
});
