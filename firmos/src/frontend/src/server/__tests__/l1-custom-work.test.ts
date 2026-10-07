import { describe, expect, it } from "vitest";

import { calculateIntakeQuote } from "@/server/quote";

import { TEST_TODAY } from "./helpers";

/**
 * L1 (H1, 10_06 00:37:30): a billable recurring custom rule must PRICE in
 * the estimate - the routing bug left it on the scheduler but out of the
 * quote. Frequency math is the engine's (weekly x4, monthly flat,
 * quarterly /3, annual /12).
 */

const BASE = {
  legalName: "Custom Co",
  engagementType: "bookkeeping",
  bookkeepingFrequency: "monthly",
  monthlyCloseTier: "10",
  bookkeepingStartDate: "2026-08-01",
  serviceKeys: [],
} as Parameters<typeof calculateIntakeQuote>[0];

describe("L1/H1: recurring_custom_prices_in_estimate", () => {
  it("a monthly billable rule becomes a priced monthly line; a weekly rule scales x4", () => {
    const quote = calculateIntakeQuote(
      {
        ...BASE,
        customRecurringRules: [
          { title: "Walk my dog", scheduleType: "monthly", isBillable: true, unitPrice: 150, subtasks: [] },
          { title: "Friday sweep", scheduleType: "weekly", isBillable: true, unitPrice: 100, subtasks: [] },
          { title: "Freebie favor", scheduleType: "monthly", isBillable: false, subtasks: [] },
        ],
      },
      TEST_TODAY,
    );

    const dog = quote.lines.find((l) => l.product_name === "Walk my dog");
    expect(dog).toBeTruthy();
    expect(dog!.service_key).toBe("custom_rule_1");
    expect(dog!.unit_price).toBe(150);
    expect(dog!.quantity).toBe(1);
    expect(dog!.amount).toBe(150);
    expect(dog!.bucket).toBe("monthly");

    const sweep = quote.lines.find((l) => l.product_name === "Friday sweep");
    expect(sweep).toBeTruthy();
    expect(sweep!.unit_price).toBe(100);
    expect(sweep!.quantity).toBe(4); // weekly x4 weeks
    expect(sweep!.amount).toBe(400);

    // Non-billable rules never price.
    expect(quote.lines.find((l) => l.product_name === "Freebie favor")).toBeUndefined();

    // The effective monthly total carries the customs: 150 + 400.
    expect(quote.totals.effectiveMonthly).toBe(550);
  });
});
