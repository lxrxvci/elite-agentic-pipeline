import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  clients,
  invoiceLineItems,
  invoices,
  recurringTasks,
  tasks,
  users,
} from "@/db/schema";
import {
  InvoiceError,
  QBO_CSV_HEADER,
  QBO_CSV_ROW_CAP,
  buildItemizedLineItems,
  byEmployeeBillingReport,
  generateMonthlyInvoices,
  getPendingBillableTasks,
  markInvoicePaid,
  markOverdueInvoices,
  quickbooksCsv,
  sendInvoice,
  voidInvoice,
} from "@/server/invoices";
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

async function invoiceFor(clientId: number, year: number, month: number) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.clientId, clientId), eq(invoices.year, year), eq(invoices.month, month)),
    )
    .limit(1);
  return invoice ?? null;
}

async function linesFor(invoiceId: number) {
  const rows = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.position);
  return rows;
}

function byKey(rows: Awaited<ReturnType<typeof linesFor>>) {
  return new Map(rows.map((r) => [r.serviceKey ?? `task:${r.taskId}`, r]));
}

describe.skipIf(!reachable)("invoices (G5 billing parity)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  // FIRST test on purpose: any monthly generation sweeps the seed's pending
  // billable tasks into that month's invoices, so this must run before the
  // other tests generate anything.
  it("seed realism: converted seed clients generate invoices with their pending billable tasks attached", async () => {
    const allClients = await db.select().from(clients);
    const harborline = allClients.find((c) => c.legalName === "Harborline Marine Supply")!;

    // The seed gave Harborline completed, uninvoiced billable ad-hoc tasks.
    const pending = await getPendingBillableTasks(harborline.id);
    expect(pending.length).toBeGreaterThanOrEqual(2);

    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const invoice = await invoiceFor(harborline.id, 2026, 8);
    expect(invoice).not.toBeNull();
    const lines = await linesFor(invoice!.id);
    const taskLines = lines.filter((l) => l.lineType === "task");
    expect(taskLines.length).toBeGreaterThanOrEqual(2);
    // Live template: 3 recon-eligible accounts at $25 each (§15 live count).
    const recon = lines.find((l) => l.serviceKey === "account_reconciliations");
    expect(recon).toMatchObject({ quantity: "3.00", unitPrice: "25.00", amount: "75.00" });
    // The attached ad-hoc tasks are stamped as invoiced.
    expect((await getPendingBillableTasks(harborline.id)).length).toBe(0);
  });

  it("bills a monthly client to the cent against hand-computed PRICING values", async () => {
    // G5 fixture: monthly close tier 10, live accounts 3 recon-eligible + 1
    // vehicle loan + 1 merchant, 2 QBO classes, one custom weekly rule, one
    // section discount. The template's reconciliation quantity (5) is
    // deliberately STALE to prove the invoice-time live recompute.
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Monthly Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "10",
        bookkeepingStartDate: "2025-06-01",
        qboClassNames: ["Retail", "Wholesale"],
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1),
          tline("account_reconciliations", "Account Reconciliations", 25, 5),
          tline("merchant_account_reconciliation", "Merchant Account Reconciliation", 25, 1),
          tline("loans_and_liabilities", "Loans and Liabilities", 25, 1),
          tline("monthly_reporting_10", "Monthly Reporting (close by the 10th)", 50, 1),
          tline("class_tracking", "Class Tracking", 25, 2),
          tline("custom_item_1", "Weekly deposit review", 20, 4, {
            frequency: "weekly",
            days_of_week: "1",
            base_quantity: 1,
          }),
          tline("__section_discount__", "Section Discount", -10, 1),
        ],
      })
      .returning();
    await db.insert(accounts).values([
      { clientId: client.id, name: "Operating", accountType: "checking", statementDay: 31 },
      { clientId: client.id, name: "Savings", accountType: "savings", statementDay: 15 },
      { clientId: client.id, name: "Business Card", accountType: "credit_card", statementDay: 20 },
      { clientId: client.id, name: "Van Loan", accountType: "vehicle_loan", statementDay: 31 },
      { clientId: client.id, name: "Stripe", accountType: "merchant", statementDay: 31 },
    ]);

    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2026, 8);
    expect(invoice).not.toBeNull();
    expect(invoice!.status).toBe("draft");
    expect(invoice!.isAutoGenerated).toBe(true);
    expect(invoice!.issueDate).toBe("2026-08-01");
    // §6.5: Net 15 from the 1st of the target month.
    expect(invoice!.dueDate).toBe("2026-08-16");

    const lines = byKey(await linesFor(invoice!.id));
    // Hand-computed from the domain PRICING table:
    // bank feed $100 x 1; recon $25 x 3 LIVE accounts (not the stale 5);
    // merchant $25 x 1; loans $25 x 1; reporting tier-10 $50 x 1;
    // classes $25 x 2; weekly rule $20 x 5 Mondays in Aug 2026
    // (3rd/10th/17th/24th/31st); discount -$10.
    expect(lines.get("bank_feed_management")).toMatchObject({
      quantity: "1.00",
      unitPrice: "100.00",
      amount: "100.00",
      lineType: "recurring",
    });
    expect(lines.get("account_reconciliations")).toMatchObject({
      quantity: "3.00",
      amount: "75.00",
    });
    expect(lines.get("merchant_account_reconciliation")).toMatchObject({ amount: "25.00" });
    expect(lines.get("loans_and_liabilities")).toMatchObject({ amount: "25.00" });
    expect(lines.get("monthly_reporting_10")).toMatchObject({ amount: "50.00" });
    expect(lines.get("class_tracking")).toMatchObject({ quantity: "2.00", amount: "50.00" });
    expect(lines.get("custom_item_1")).toMatchObject({ quantity: "5.00", amount: "100.00" });
    expect(lines.get("__section_discount__")).toMatchObject({
      description: "Preferred Customer Discount",
      amount: "-10.00",
      lineType: "other",
    });
    expect(lines.size).toBe(8);
    // 100 + 75 + 25 + 25 + 50 + 50 + 100 - 10 = 415.00
    expect(invoice!.total).toBe("415.00");
  });

  it("renormalizes quantities for a quarterly-billed client (one invoice covers 3 months)", async () => {
    // G5 fixture: monthly BOOKKEEPING cadence (intake cycle 1), quarterly
    // BILLING (billing cycle 3), anchored January -> cycle months 1/4/7/10.
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Quarterly Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "quarterly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-15",
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1),
          tline("monthly_reporting_15", "Monthly Reporting (close by the 15th)", 25, 1),
        ],
      })
      .returning();

    await generateMonthlyInvoices(2026, 7, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2026, 7);
    expect(invoice).not.toBeNull();
    const lines = byKey(await linesFor(invoice!.id));
    // §6.5: quantity / intake_cycle x billing_cycle = 1 / 1 x 3.
    expect(lines.get("bank_feed_management")).toMatchObject({
      quantity: "3.00",
      amount: "300.00",
    });
    expect(lines.get("monthly_reporting_15")).toMatchObject({
      quantity: "3.00",
      amount: "75.00",
    });
    expect(invoice!.total).toBe("375.00");
    expect(invoice!.dueDate).toBe("2026-07-16");

    // Non-cycle month: August is month 2 of the quarter - no invoice.
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    expect(await invoiceFor(client.id, 2026, 8)).toBeNull();
  });

  it("bills February-billed 1099 services only in February of years after the anchor year", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 1099 Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        // Anchor year 2025: the first partial year is never charged (§6.5).
        bookkeepingStartDate: "2025-06-01",
        estimated1099Count: 4,
        include1099Collection: true,
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1),
          tline("1099_collection", "1099 Collection", 50, 1, { frequency: "annual" }),
          tline("1099_per_filing", "1099 Per Filing", 10, 4, { frequency: "annual" }),
        ],
      })
      .returning();
    const [newClient] = await db
      .insert(clients)
      .values({
        legalName: "G5 1099 New Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        // Anchor year 2026: February 2026 is the client's first partial year.
        bookkeepingStartDate: "2026-01-01",
        estimated1099Count: 4,
        include1099Collection: true,
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1),
          tline("1099_collection", "1099 Collection", 50, 1, { frequency: "annual" }),
        ],
      })
      .returning();

    await generateMonthlyInvoices(2026, 1, TEST_TODAY);
    const jan = await invoiceFor(client.id, 2026, 1);
    expect(jan).not.toBeNull();
    const janLines = byKey(await linesFor(jan!.id));
    expect(janLines.has("1099_collection")).toBe(false);
    expect(janLines.has("1099_per_filing")).toBe(false);
    expect(jan!.total).toBe("100.00");

    await generateMonthlyInvoices(2026, 2, TEST_TODAY);
    const feb = await invoiceFor(client.id, 2026, 2);
    const febLines = byKey(await linesFor(feb!.id));
    expect(febLines.get("1099_collection")).toMatchObject({ quantity: "1.00", amount: "50.00" });
    expect(febLines.get("1099_per_filing")).toMatchObject({ quantity: "4.00", amount: "40.00" });
    expect(feb!.total).toBe("190.00");

    // Same-year February: 2026 is NOT later than the 2026 anchor year.
    const newFeb = await invoiceFor(newClient.id, 2026, 2);
    expect(newFeb).not.toBeNull();
    const newFebLines = byKey(await linesFor(newFeb!.id));
    expect(newFebLines.has("1099_collection")).toBe(false);
    expect(newFeb!.total).toBe("100.00");
  });

  it("is idempotent: a re-run skips every existing period", async () => {
    const first = await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    expect(first.invoicesCreated).toBeGreaterThan(0);
    const second = await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    expect(second.invoicesCreated).toBe(0);
    expect(second.skippedExisting).toBeGreaterThan(0);
    expect(second.failures).toEqual([]);
  });

  it("never persists an invoice that ends up with no line items", async () => {
    // Template whose only line is unpriced in §15 (daily reporting has no
    // stated amount) - builds zero billable lines.
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Empty Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        recurringServicesTemplate: [
          tline("daily_reporting", "Daily Reporting", null, 1, {
            notes: "Priced manually: no amount stated in HANDOFF §15.",
          }),
        ],
      })
      .returning();

    const summary = await generateMonthlyInvoices(2026, 10, TEST_TODAY);
    expect(await invoiceFor(client.id, 2026, 10)).toBeNull();
    expect(summary.emptySkipped).toBeGreaterThanOrEqual(1);
  });

  it("attaches completed billable tasks once, stamps them, and leaves the rest alone", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Tasks Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        recurringServicesTemplate: [tline("bank_feed_management", "Bank Feed Management", 100, 1)],
      })
      .returning();
    const [rule] = await db
      .insert(recurringTasks)
      .values({
        clientId: client.id,
        title: "Monthly cleanup block",
        scheduleType: "monthly",
        dayOfMonth: 20,
        nextRun: "2099-01-20",
        isCustom: true,
        isBillable: true,
        unitPrice: "75.00",
      })
      .returning();
    const base = {
      clientId: client.id,
      recurringTaskId: rule.id,
      taskType: "recurring" as const,
      attributedYear: 2026,
    };
    const [uninvoiced] = await db
      .insert(tasks)
      .values({
        ...base,
        title: "Cleanup block - July",
        status: "completed",
        billableStatus: "billable",
        attributedMonth: 7,
        completedAt: new Date(),
      })
      .returning();
    await db.insert(tasks).values([
      {
        ...base,
        title: "Cleanup block - June (already invoiced)",
        status: "completed",
        billableStatus: "billable",
        attributedMonth: 6,
        completedAt: new Date(),
        invoicedAt: new Date(),
      },
      {
        ...base,
        title: "Cleanup block - May (non-billable)",
        status: "completed",
        billableStatus: "non_billable",
        attributedMonth: 5,
        completedAt: new Date(),
      },
      {
        ...base,
        title: "Cleanup block - April (still open)",
        status: "in_progress",
        billableStatus: "billable",
        attributedMonth: 4,
      },
    ]);

    // The pending queue shows exactly the one completed, uninvoiced task.
    const pendingBefore = await getPendingBillableTasks(client.id);
    expect(pendingBefore.map((t) => t.taskId)).toEqual([uninvoiced.id]);
    expect(pendingBefore[0].unitPrice).toBe("75.00");

    await generateMonthlyInvoices(2026, 11, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2026, 11);
    const lines = await linesFor(invoice!.id);
    const taskLine = lines.find((l) => l.lineType === "task");
    expect(taskLine).toMatchObject({
      taskId: uninvoiced.id,
      description: "Cleanup block - July",
      quantity: "1.00",
      unitPrice: "75.00",
      amount: "75.00",
    });
    // 100 bank feed + 75 task line.
    expect(invoice!.total).toBe("175.00");

    // The attached task is stamped; the others are untouched.
    const [stamped] = await db.select().from(tasks).where(eq(tasks.id, uninvoiced.id));
    expect(stamped.invoicedAt).not.toBeNull();
    expect((await getPendingBillableTasks(client.id)).map((t) => t.taskId)).toEqual([]);
  });

  it("enforces the lifecycle legal paths and the overdue sweep", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Lifecycle Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        recurringServicesTemplate: [tline("bank_feed_management", "Bank Feed Management", 100, 1)],
      })
      .returning();
    await generateMonthlyInvoices(2026, 12, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2026, 12);

    const sent = await sendInvoice(invoice!.id);
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).not.toBeNull();
    await expect(sendInvoice(invoice!.id)).rejects.toThrow(InvoiceError);

    const paid = await markInvoicePaid(invoice!.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    await expect(voidInvoice(invoice!.id)).rejects.toThrow(InvoiceError);

    // Manual rows for the overdue sweep: past-due sent flips, future-due sent
    // and past-due draft do not.
    const [pastDue] = await db
      .insert(invoices)
      .values({
        clientId: client.id,
        status: "sent",
        issueDate: "2020-01-01",
        dueDate: "2020-01-16",
        total: "10.00",
        sentAt: new Date("2020-01-01T12:00:00Z"),
      })
      .returning();
    const [futureDue] = await db
      .insert(invoices)
      .values({
        clientId: client.id,
        status: "sent",
        issueDate: "2099-01-01",
        dueDate: "2099-01-16",
        total: "10.00",
        sentAt: new Date(),
      })
      .returning();
    const [draftPastDue] = await db
      .insert(invoices)
      .values({ clientId: client.id, status: "draft", dueDate: "2020-01-16", total: "10.00" })
      .returning();

    const sweep = await markOverdueInvoices(TEST_TODAY);
    expect(sweep.invoiceIds).toContain(pastDue.id);
    expect(sweep.invoiceIds).not.toContain(futureDue.id);
    expect(sweep.invoiceIds).not.toContain(draftPastDue.id);

    // An overdue invoice is still payable.
    const paidLate = await markInvoicePaid(pastDue.id);
    expect(paidLate.status).toBe("paid");
  });

  it("exports the QuickBooks CSV with mm/dd/yyyy dates and the 1000-row cap", async () => {
    const [client] = await db
      .insert(clients)
      .values({ legalName: "G5 CSV, Fixture" }) // comma exercises quoting
      .returning();
    const [invoice] = await db
      .insert(invoices)
      .values({
        clientId: client.id,
        invoiceNumber: "INV-CSV-1",
        status: "sent",
        issueDate: "2026-08-01",
        dueDate: "2026-08-16",
        total: "175.00",
      })
      .returning();
    await db.insert(invoiceLineItems).values([
      {
        invoiceId: invoice.id,
        lineType: "recurring",
        serviceKey: "bank_feed_management",
        description: "Bank Feed Management",
        quantity: "1.00",
        unitPrice: "100.00",
        amount: "100.00",
        position: 0,
      },
      {
        invoiceId: invoice.id,
        lineType: "task",
        description: "Cleanup block - July",
        quantity: "1.00",
        unitPrice: "75.00",
        amount: "75.00",
        position: 1,
      },
    ]);

    const csv = await quickbooksCsv([invoice.id]);
    const rows = csv.trimEnd().split("\n");
    expect(rows[0]).toBe(QBO_CSV_HEADER);
    expect(rows[0]).toBe(
      "Invoice No,Customer,Invoice Date,Due Date,Item,Description,Qty,Rate,Amount",
    );
    expect(rows[1]).toBe(
      'INV-CSV-1,"G5 CSV, Fixture",08/01/2026,08/16/2026,Bank Feed Management,Bank Feed Management,1,100.00,100.00',
    );
    expect(rows[2]).toBe(
      'INV-CSV-1,"G5 CSV, Fixture",08/01/2026,08/16/2026,Billable Task,Cleanup block - July,1,75.00,75.00',
    );

    // The 1000-row cap (§15).
    const [bigInvoice] = await db
      .insert(invoices)
      .values({
        clientId: client.id,
        invoiceNumber: "INV-CSV-BIG",
        status: "draft",
        issueDate: "2026-08-01",
        dueDate: "2026-08-16",
        total: "0.00",
      })
      .returning();
    const bulk = Array.from({ length: QBO_CSV_ROW_CAP + 5 }, (_, i) => ({
      invoiceId: bigInvoice.id,
      lineType: "other" as const,
      description: `Bulk line ${i}`,
      quantity: "1.00",
      unitPrice: "0.00",
      amount: "0.00",
      position: i,
    }));
    for (let i = 0; i < bulk.length; i += 500) {
      await db.insert(invoiceLineItems).values(bulk.slice(i, i + 500));
    }
    const bigCsv = await quickbooksCsv([bigInvoice.id]);
    expect(bigCsv.trimEnd().split("\n").length).toBe(QBO_CSV_ROW_CAP + 1); // header + cap
  });

  it("groups invoiced totals by client bookkeeper for the month", async () => {
    const [jorge] = await db.select().from(users).where(eq(users.email, "jorge@blueledgerbooks.com"));
    const [client] = await db
      .insert(clients)
      .values({ legalName: "G5 Report Fixture", bookkeeperId: jorge.id })
      .returning();
    const now = new Date();
    await db.insert(invoices).values({
      clientId: client.id,
      invoiceNumber: "INV-REPORT-1",
      status: "sent",
      issueDate: "2026-08-01",
      dueDate: "2026-08-16",
      total: "123.45",
      sentAt: now,
    });

    const report = await byEmployeeBillingReport(now.getFullYear(), now.getMonth() + 1);
    const row = report.find((r) => r.bookkeeperId === jorge.id);
    expect(row).toBeDefined();
    expect(row!.bookkeeperName).toBe("Jorge Medina");
    expect(row!.invoiceCount).toBeGreaterThanOrEqual(1);
    expect(Number(row!.total)).toBeGreaterThanOrEqual(123.45);
  });

  it("bills the frozen legacy path from the flat monthly amount when no template exists", async () => {
    // §30 conv. 7: the template-less branch is frozen - flat amount x cycle.
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "G5 Legacy Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        monthlyRecurringAmount: "500.00",
      })
      .returning();
    await generateMonthlyInvoices(2027, 3, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2027, 3);
    expect(invoice).not.toBeNull();
    const lines = await linesFor(invoice!.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineType: "recurring",
      serviceKey: null,
      description: "Monthly Bookkeeping Services",
      quantity: "1.00",
      unitPrice: "500.00",
      amount: "500.00",
    });
  });

  it("buildItemizedLineItems recomputes the reconciliation count from live data", async () => {
    const allClients = await db.select().from(clients);
    const harborline = allClients.find((c) => c.legalName === "Harborline Marine Supply")!;
    const before = await buildItemizedLineItems(harborline, 2027, 6, TEST_TODAY);
    const reconBefore = before.find((l) => l.serviceKey === "account_reconciliations");
    expect(reconBefore).toMatchObject({ quantity: 3, amount: 75 });

    // A new active statement-day account immediately raises the billed count.
    await db.insert(accounts).values({
      clientId: harborline.id,
      name: "New Money Market",
      accountType: "savings",
      statementDay: 31,
    });
    const after = await buildItemizedLineItems(harborline, 2027, 6, TEST_TODAY);
    expect(after.find((l) => l.serviceKey === "account_reconciliations")).toMatchObject({
      quantity: 4,
      amount: 100,
    });
  });
});
