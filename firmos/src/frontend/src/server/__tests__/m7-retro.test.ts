import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, invoiceLineItems, invoices } from "@/db/schema";
import { generateMonthlyInvoices } from "@/server/invoices";
import { buildRecurringServicesTemplate, type TemplateLineItem } from "@/server/quote";
import type { Quote } from "@firmos/domain";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * M7 (A11, 10_10 00:53:32, meeting #5): the retro cleanup bills at a picked
 * frequency - "am I billing this per month, per quarter, per year… keep the
 * same logic as these other ones." Installments of 1/3/12 cleanup months
 * ride the normal invoices until the cleanup total is covered.
 */

const reachable = await dbReachable();

const RETRO_QUOTE: Quote = {
  billingCycle: 1,
  lines: [
    { service_key: "bank_feed_management", product_name: "Bank Feed Management", unit_price: 100, quantity: 1, amount: 100, bucket: "monthly", unpriced: false },
    { service_key: "retroactive_bookkeeping", product_name: "Retroactive Bookkeeping", unit_price: 200, quantity: 6, amount: 1200, bucket: "one_time", unpriced: false },
  ],
  totals: {
    totalMonthly: 100,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
    totalFebruaryBilledAnnual: 0,
    totalOneTime: 1200,
    effectiveMonthly: 100,
  },
};

function retroTline(quantity: number, freq?: string): TemplateLineItem {
  return {
    service_key: "retroactive_bookkeeping",
    product_name: "Retroactive Bookkeeping",
    unit_price: 200,
    quantity,
    discount: 0,
    frequency: "one_time",
    notes: null,
    ...(freq ? { retro_billing_frequency: freq } : {}),
  };
}

async function retroLines(clientId: number, year: number, month: number) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, clientId), eq(invoices.year, year), eq(invoices.month, month)))
    .limit(1);
  if (!invoice) return null;
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id));
  return { invoice, retro: lines.filter((l) => l.serviceKey === "retroactive_bookkeeping") };
}

describe.skipIf(!reachable)("M7 retro cleanup billing frequency", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("the template stamps retro_billing_frequency only when picked", () => {
    const stamped = buildRecurringServicesTemplate(RETRO_QUOTE, [], [], [], {}, {}, {
      retroBillingFrequency: "quarterly",
    });
    expect(stamped.find((l) => l.service_key === "retroactive_bookkeeping")).toMatchObject({
      retro_billing_frequency: "quarterly",
    });
    const unstamped = buildRecurringServicesTemplate(RETRO_QUOTE);
    expect(unstamped.find((l) => l.service_key === "retroactive_bookkeeping")).not.toHaveProperty(
      "retro_billing_frequency",
    );
  });

  it("retro_installments_bill_monthly_until_covered", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "M7 Monthly Retro Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2025-07-01",
        recurringServicesTemplate: [
          {
            service_key: "bank_feed_management",
            product_name: "Bank Feed Management",
            unit_price: 100,
            quantity: 1,
            discount: 0,
            frequency: "monthly",
            notes: null,
          },
          retroTline(2, "monthly"),
        ],
      })
      .returning();

    // Month 1: installment 1 of 2 ($200).
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const first = await retroLines(client.id, 2026, 8);
    expect(first?.retro).toHaveLength(1);
    expect(first?.retro[0]).toMatchObject({ quantity: "1.00", amount: "200.00", description: "Retroactive cleanup (installment 1)" });

    // A rerun of the same month does not double-bill (the generator's
    // (client, year, month) guard skips the existing auto invoice).
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const again = await retroLines(client.id, 2026, 8);
    expect(again?.retro).toHaveLength(1);

    // Month 2: installment 2 completes the cleanup (quantity 2 total).
    await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    const second = await retroLines(client.id, 2026, 9);
    expect(second?.retro).toHaveLength(1);
    expect(second?.retro[0]).toMatchObject({ quantity: "1.00", description: "Retroactive cleanup (installment 2)" });

    // Month 3: covered - no retro line.
    await generateMonthlyInvoices(2026, 10, TEST_TODAY);
    const third = await retroLines(client.id, 2026, 10);
    expect(third?.retro).toHaveLength(0);
  });

  it("retro_installments_bill_quarterly_with_remainder", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "M7 Quarterly Retro Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2025-03-01",
        recurringServicesTemplate: [retroTline(5, "quarterly")],
      })
      .returning();

    // Anchor month: 3 cleanup months ($600).
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const first = await retroLines(client.id, 2026, 8);
    expect(first?.retro).toHaveLength(1);
    expect(first?.retro[0]).toMatchObject({ quantity: "3.00", amount: "600.00" });

    // The two following months bill no retro (off cadence - and with no
    // other template lines those months generate no invoice at all).
    await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    await generateMonthlyInvoices(2026, 10, TEST_TODAY);
    for (const month of [9, 10]) {
      const r = await retroLines(client.id, 2026, month);
      expect(r == null || r.retro.length === 0).toBe(true);
    }

    // Quarter month: the remaining 2 cleanup months ($400).
    await generateMonthlyInvoices(2026, 11, TEST_TODAY);
    const fourth = await retroLines(client.id, 2026, 11);
    expect(fourth?.retro).toHaveLength(1);
    expect(fourth?.retro[0]).toMatchObject({ quantity: "2.00", amount: "400.00", description: "Retroactive cleanup (installment 2)" });
  });

  it("an unstamped one-time retro line keeps the legacy behavior (never auto-billed)", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "M7 Legacy Retro Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2025-03-01",
        recurringServicesTemplate: [retroTline(6)],
      })
      .returning();
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    expect((await retroLines(client.id, 2026, 8))?.retro ?? []).toHaveLength(0);
  });
});
