import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { accounts, clients, recurringTasks } from "@/db/schema";
import {
  resyncAllBilling,
  resyncClientBillingFromLiveState,
} from "@/server/billing-sync";
import type { TemplateLineItem } from "@/server/quote";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

function tline(
  service_key: string,
  product_name: string,
  unit_price: number | null,
  quantity: number,
  extra: Record<string, unknown> = {},
): TemplateLineItem {
  return {
    service_key,
    product_name,
    unit_price,
    quantity,
    discount: 0,
    frequency: "monthly",
    notes: null,
    ...extra,
  };
}

function templateOf(client: { recurringServicesTemplate: unknown }): TemplateLineItem[] {
  return (client.recurringServicesTemplate ?? []) as TemplateLineItem[];
}

async function clientById(id: number) {
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!row) throw new Error(`fixture client missing: ${id}`);
  return row;
}

describe.skipIf(!reachable)("billing-sync: resyncClientBillingFromLiveState", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("rebuilds from live state, keeps manual edits winning, drops stale managed keys, restamps amounts", async () => {
    // G5 fixture: template with a STALE class-tracking quantity (5 vs 1 live
    // class), a manual reconciliation line ($30 x 2 - must win outright), a
    // manual extra (custom_item_42 - must be appended), and a quarterly
    // reporting key the CURRENT monthly cadence no longer justifies.
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Resync Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2025-01-01",
        include1099Collection: true,
        estimated1099Count: 3,
        qboClassNames: ["A"],
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1),
          tline("class_tracking", "Class Tracking", 25, 5),
          tline("account_reconciliations", "Account Reconciliations", 30, 2, {
            manual_edit: true,
          }),
          tline("custom_item_42", "Legacy cleanup", 15, 1, { manual_edit: true }),
          tline("quarterly_reporting", "Quarterly Reporting", 25, 1, { frequency: "quarterly" }),
        ],
      })
      .returning();
    // Live state: 2 recon-eligible, 1 vehicle loan, 1 merchant.
    await db.insert(accounts).values([
      { clientId: client.id, name: "Operating", accountType: "checking", statementDay: 31 },
      { clientId: client.id, name: "Savings", accountType: "savings", statementDay: 15 },
      { clientId: client.id, name: "Van Loan", accountType: "vehicle_loan", statementDay: 31 },
      { clientId: client.id, name: "Stripe", accountType: "merchant", statementDay: 31 },
    ]);

    const result = await resyncClientBillingFromLiveState(client.id, TEST_TODAY);
    const merged = templateOf(await clientById(client.id));
    const byKey = new Map(merged.map((l) => [l.service_key, l]));

    // Manual line wins outright for its key ($30 x 2, NOT the rebuilt $25 x live-count).
    expect(byKey.get("account_reconciliations")).toMatchObject({ unit_price: 30, quantity: 2 });
    // Manual extra is appended.
    expect(byKey.get("custom_item_42")).toMatchObject({ unit_price: 15, quantity: 1 });
    // Live-derivable lines follow live state.
    expect(byKey.get("class_tracking")).toMatchObject({ unit_price: 25, quantity: 1 });
    expect(byKey.get("merchant_account_reconciliation")).toBeDefined(); // 1 live merchant
    expect(byKey.get("loans_and_liabilities")).toBeDefined(); // 1 live loan
    expect(byKey.get("bank_feed_management")).toMatchObject({ unit_price: 100 });
    // Current cadence reporting replaces the stale quarterly key.
    expect(byKey.get("monthly_reporting_15")).toBeDefined();
    expect(byKey.has("quarterly_reporting")).toBe(false);
    // 1099 flags feed the February-billed services.
    expect(byKey.get("1099_collection")).toMatchObject({ unit_price: 50 });
    expect(byKey.get("1099_per_filing")).toMatchObject({ unit_price: 10, quantity: 3 });

    // Hand-computed stamps (cycle 1): monthly bucket = bank 100 + merchant 25
    // + loans 25 + reporting 25 + class 25 + manual recon 60 + manual extra 15
    // = 275; the February-billed 1099 lines are excluded from the annual term.
    expect(result.monthlyRecurringAmount).toBe("275.00");
    expect(result.baseMonthlyAmount).toBe("275.00");
    expect(result.perAccountPrice).toBe("30.00"); // the manual line's price
    expect(result.manualLinesKept).toBe(2);

    const stamped = await clientById(client.id);
    expect(stamped.monthlyRecurringAmount).toBe("275.00");
    expect(stamped.billingLastSyncedAt).not.toBeNull();

    // Drop-on-zero: deleting the merchant account removes its line.
    await db.delete(accounts).where(eq(accounts.name, "Stripe"));
    await resyncClientBillingFromLiveState(client.id, TEST_TODAY);
    const after = templateOf(await clientById(client.id));
    expect(after.some((l) => l.service_key === "merchant_account_reconciliation")).toBe(false);
    // And the manual lines still survive the second rebuild.
    expect(after.find((l) => l.service_key === "account_reconciliations")).toMatchObject({
      unit_price: 30,
      quantity: 2,
    });
    expect(after.some((l) => l.service_key === "custom_item_42")).toBe(true);
  });

  it("builds custom_item lines from live custom billable rules with schedule fields", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Custom Rule Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
      })
      .returning();
    await db.insert(accounts).values({
      clientId: client.id,
      name: "Operating",
      accountType: "checking",
      statementDay: 31,
    });
    await db.insert(recurringTasks).values({
      clientId: client.id,
      title: "Weekly deposit review",
      scheduleType: "weekly",
      daysOfWeek: "1",
      nextRun: "2099-01-05",
      isCustom: true,
      isBillable: true,
      unitPrice: "20.00",
    });

    await resyncClientBillingFromLiveState(client.id, TEST_TODAY);
    const merged = templateOf(await clientById(client.id));
    const custom = merged.find((l) => l.service_key === "custom_item_1");
    expect(custom).toBeDefined();
    expect(custom).toMatchObject({
      product_name: "Weekly deposit review",
      unit_price: 20,
      frequency: "weekly",
      // §15 weekly scaling x4 at the monthly cycle; invoice-time recompute
      // uses the stamped days_of_week instead.
      quantity: 4,
      days_of_week: "1",
      base_quantity: 1,
    });
    // Fresh template defaults: bank feed + recon (1 live account) + tier reporting.
    expect(merged.some((l) => l.service_key === "bank_feed_management")).toBe(true);
    expect(merged.some((l) => l.service_key === "account_reconciliations")).toBe(true);
    expect(merged.some((l) => l.service_key === "monthly_reporting_15")).toBe(true);
  });

  it("resyncAllBilling backfills every non-project client without failures", async () => {
    const summary = await resyncAllBilling(TEST_TODAY);
    expect(summary.failures).toEqual([]);
    expect(summary.clientsResynced).toBeGreaterThanOrEqual(5);
    // A seed client (Harborline: 3 recon-eligible accounts) now bills from a template.
    const harborline = (await db.select().from(clients)).find(
      (c) => c.legalName === "Harborline Marine Supply",
    )!;
    const template = templateOf(harborline);
    const recon = template.find((l) => l.service_key === "account_reconciliations");
    expect(recon).toMatchObject({ unit_price: 25, quantity: 3 });
    // The project engagement never gets a template.
    const summit = (await db.select().from(clients)).find(
      (c) => c.legalName === "Summit Peak Builders",
    )!;
    expect(templateOf(summit)).toHaveLength(0);
  });
});
