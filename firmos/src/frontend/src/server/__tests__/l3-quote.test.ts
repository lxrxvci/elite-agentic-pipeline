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
