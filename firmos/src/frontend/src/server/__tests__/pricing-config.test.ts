import { COMMISSION_TIERS } from "@firmos/domain";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  appSettings,
  auditEvents,
  clients,
  invoiceLineItems,
  invoices,
  tasks,
  users,
} from "@/db/schema";
import { generateMonthlyInvoices } from "@/server/invoices";
import { getCommissionReport } from "@/server/payroll";
import {
  PricingConfigError,
  getCommissionFloorRate,
  getCommissionTiers,
  getEffectivePricing,
  getPricingOverrides,
  setCommissionFloorRate,
  setCommissionTiers,
  setPricingOverride,
} from "@/server/pricing-config";
import { calculateIntakeQuoteWithConfig, type TemplateLineItem } from "@/server/quote";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

const CONFIG_KEYS = ["pricing_overrides", "commission_tiers"];

let seq = 0;
const fixtureIds = { users: [] as number[], clients: [] as number[] };

async function makeUser(
  role: "owner" | "admin" | "manager" | "bookkeeper",
  extra: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `pricing-test-${seq}@firmos-test.local`,
      firstName: "Price",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
      ...extra,
    })
    .returning();
  fixtureIds.users.push(u.id);
  return u;
}

async function makeClient(extra: Partial<typeof clients.$inferInsert> = {}) {
  seq += 1;
  const [c] = await db
    .insert(clients)
    .values({ legalName: `Pricing Test Client ${seq}`, ...extra })
    .returning();
  fixtureIds.clients.push(c.id);
  return c;
}

async function makeTasks(assigneeId: number, clientId: number, total: number, onTime: number) {
  for (let i = 0; i < total; i += 1) {
    seq += 1;
    const completed = i < onTime;
    await db.insert(tasks).values({
      title: `Pricing tier task ${seq}`,
      clientId,
      assigneeId,
      dueDate: "2026-08-10",
      status: completed ? "completed" : "open",
      completedAt: completed ? new Date(2026, 7, 10, 12) : null,
      completedById: completed ? assigneeId : null,
    });
  }
}

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

async function auditRowsFor(action: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.action, action));
}

describe.skipIf(!reachable)("pricing config (admin-editable pricing + commission tiers)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterEach(async () => {
    // Config keys are global state: never leak them across tests or files.
    await db.delete(appSettings).where(inArray(appSettings.key, CONFIG_KEYS));
  });

  it("defaults: no overrides, HANDOFF commission tiers", async () => {
    expect(await getPricingOverrides()).toEqual({});
    expect(await getCommissionTiers()).toEqual([
      { minOnTimePercent: 100, rate: 50 },
      { minOnTimePercent: 90, rate: 45 },
      { minOnTimePercent: 80, rate: 40 },
      { minOnTimePercent: 0, rate: 35 },
    ]);
    const rows = await getEffectivePricing();
    const feed = rows.find((r) => r.serviceKey === "bank_feed_management")!;
    expect(feed.override).toBeNull();
    expect(feed.effectivePrice).toBe(100);
  });

  it("set/get/remove a pricing override, with validation", async () => {
    const admin = await makeUser("admin");

    await setPricingOverride("bank_feed_management", 120, admin.id);
    await setPricingOverride("quickbooks_plus", 99.5, admin.id);
    expect(await getPricingOverrides()).toEqual({
      bank_feed_management: 120,
      quickbooks_plus: 99.5,
    });

    // Effective table reflects the merge.
    const rows = await getEffectivePricing();
    expect(rows.find((r) => r.serviceKey === "bank_feed_management")!.effectivePrice).toBe(120);
    expect(rows.find((r) => r.serviceKey === "account_reconciliations")!.effectivePrice).toBe(25);

    // Cents are kept; over-precision is rounded to cents.
    await setPricingOverride("account_reconciliations", 27.555, admin.id);
    expect((await getPricingOverrides()).account_reconciliations).toBe(27.56);

    // null removes the override.
    await setPricingOverride("bank_feed_management", null, admin.id);
    expect(await getPricingOverrides()).toEqual({
      quickbooks_plus: 99.5,
      account_reconciliations: 27.56,
    });

    // Validation: unknown keys and bad prices never reach the store.
    await expect(setPricingOverride("not_a_service", 10, admin.id)).rejects.toThrow(
      PricingConfigError,
    );
    await expect(setPricingOverride("bank_feed_management", -1, admin.id)).rejects.toThrow(
      /between 0 and/,
    );
    await expect(
      setPricingOverride("bank_feed_management", Number.NaN, admin.id),
    ).rejects.toThrow(/between 0 and/);
    expect(await getPricingOverrides()).toEqual({
      quickbooks_plus: 99.5,
      account_reconciliations: 27.56,
    });
  });

  it("every pricing change is audit-logged with before/after", async () => {
    const admin = await makeUser("admin");
    await setPricingOverride("bank_feed_management", 120, admin.id);
    await setPricingOverride("bank_feed_management", null, admin.id);

    const sets = (await auditRowsFor("pricing_override_set")).filter(
      (r) => (r.details as { serviceKey?: string } | null)?.serviceKey === "bank_feed_management",
    );
    expect(sets.length).toBeGreaterThanOrEqual(1);
    const last = sets[sets.length - 1]!;
    expect(last.userId).toBe(admin.id);
    expect(last.entityType).toBe("app_settings");
    expect(last.details).toMatchObject({
      key: "pricing_overrides",
      serviceKey: "bank_feed_management",
      previousPrice: null,
      newPrice: 120,
      defaultPrice: 100,
    });

    const clears = (await auditRowsFor("pricing_override_cleared")).filter(
      (r) => (r.details as { serviceKey?: string } | null)?.serviceKey === "bank_feed_management",
    );
    expect(clears.length).toBeGreaterThanOrEqual(1);
    expect(clears[clears.length - 1]!.details).toMatchObject({
      serviceKey: "bank_feed_management",
      previousPrice: 120,
      newPrice: null,
    });
  });

  it("an override flows through calculateIntakeQuoteWithConfig to a changed effective monthly", async () => {
    const admin = await makeUser("admin");
    const answers = {
      bookkeepingFrequency: "monthly",
      serviceKeys: ["bank_feed_management", "monthly_reporting_15"],
      quickbooksStatus: "has_qbo",
      qboUserCount: 1,
    };

    const base = await calculateIntakeQuoteWithConfig(answers, TEST_TODAY);
    // 100 bank feed + 25 reporting + 30 Simple Start pass-through.
    expect(base.totals.effectiveMonthly).toBe(155);

    await setPricingOverride("bank_feed_management", 120, admin.id);
    await setPricingOverride("quickbooks_simple_start", 35, admin.id);
    const overridden = await calculateIntakeQuoteWithConfig(answers, TEST_TODAY);
    expect(overridden.totals.effectiveMonthly).toBe(180);
    const feedLine = overridden.lines.find((l) => l.service_key === "bank_feed_management")!;
    expect(feedLine.unit_price).toBe(120);
    const qboLine = overridden.lines.find((l) => l.service_key === "quickbooks_simple_start")!;
    expect(qboLine.unit_price).toBe(35);
  });

  it("commission tiers: set validates ordering and ranges, and is audit-logged", async () => {
    const admin = await makeUser("admin");

    await expect(setCommissionTiers([], admin.id)).rejects.toThrow(/At least one tier/);
    await expect(
      setCommissionTiers(
        [
          { minOnTimePercent: 80, rate: 40 },
          { minOnTimePercent: 90, rate: 45 }, // ascending: rejected
        ],
        admin.id,
      ),
    ).rejects.toThrow(/strictly descending/);
    await expect(
      setCommissionTiers([{ minOnTimePercent: 101, rate: 50 }], admin.id),
    ).rejects.toThrow(/between 0 and 100/);
    await expect(
      setCommissionTiers([{ minOnTimePercent: 90, rate: 110 }], admin.id),
    ).rejects.toThrow(/between 0 and 100/);

    const saved = await setCommissionTiers(
      [
        { minOnTimePercent: 99, rate: 45 },
        { minOnTimePercent: 90, rate: 40 },
        { minOnTimePercent: 0, rate: 35 },
      ],
      admin.id,
    );
    expect(saved).toEqual([
      { minOnTimePercent: 99, rate: 45 },
      { minOnTimePercent: 90, rate: 40 },
      { minOnTimePercent: 0, rate: 35 },
    ]);
    expect(await getCommissionTiers()).toEqual(saved);

    const events = await auditRowsFor("commission_tiers_updated");
    const last = events[events.length - 1]!;
    expect(last.userId).toBe(admin.id);
    expect(last.details).toMatchObject({
      key: "commission_tiers",
      newTiers: saved,
    });
  });

  it("commission floor rate: set/get/validate, and the no-data case uses it", async () => {
    const admin = await makeUser("admin");
    const bk = await makeUser("bookkeeper");
    const client = await makeClient({ bookkeeperId: bk.id });
    void client; // no tasks: the no-data case (onTimePercent null) hits the floor
    // Pin the default tier table: earlier tests persist custom tiers to
    // app_settings. The default table ends in a 0-threshold 35% tier, so the
    // floor only applies when there is no on-time data.
    await setCommissionTiers(COMMISSION_TIERS.map((t) => ({ ...t })), admin.id);
    await setCommissionFloorRate(35, admin.id);

    const base = await getCommissionReport(2026, 8, TEST_TODAY);
    const baseRow = base.rows.find((r) => r.userId === bk.id)!;
    expect(baseRow.onTimePercent).toBeNull();
    expect(baseRow.rate).toBe(35);

    await setCommissionFloorRate(30, admin.id);
    expect(await getCommissionFloorRate()).toBe(30);
    const report = await getCommissionReport(2026, 8, TEST_TODAY);
    expect(report.rows.find((r) => r.userId === bk.id)!.rate).toBe(30);

    await expect(setCommissionFloorRate(-1, admin.id)).rejects.toThrow(/between 0 and 100/);
    await expect(setCommissionFloorRate(101, admin.id)).rejects.toThrow(/between 0 and 100/);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "commission_floor_rate_updated"));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("the commission report respects custom tiers (owner's 99% -> 45% example)", async () => {
    const admin = await makeUser("admin");
    const bk = await makeUser("bookkeeper");
    const client = await makeClient({ bookkeeperId: bk.id });
    await makeTasks(bk.id, client.id, 100, 99); // 99% on time

    const baseReport = await getCommissionReport(2026, 8, TEST_TODAY);
    expect(baseReport.rows.find((r) => r.userId === bk.id)!.rate).toBe(45); // default 90-tier

    // Owner's edit: 99%+ earns 45%, 90-98 earns 40%, below that 35%.
    await setCommissionTiers(
      [
        { minOnTimePercent: 99, rate: 45 },
        { minOnTimePercent: 90, rate: 40 },
        { minOnTimePercent: 0, rate: 35 },
      ],
      admin.id,
    );
    const report = await getCommissionReport(2026, 8, TEST_TODAY);
    const row = report.rows.find((r) => r.userId === bk.id)!;
    expect(row.onTimePercent).toBe(99);
    expect(row.rate).toBe(45);

    // A stricter table drops the same performance to 40%.
    await setCommissionTiers(
      [
        { minOnTimePercent: 100, rate: 50 },
        { minOnTimePercent: 0, rate: 40 },
      ],
      admin.id,
    );
    const stricter = await getCommissionReport(2026, 8, TEST_TODAY);
    expect(stricter.rows.find((r) => r.userId === bk.id)!.rate).toBe(40);
  });

  it("an invoice generates with the overridden price to the cent (G5 fixture approach)", async () => {
    const admin = await makeUser("admin");
    const client = await makeClient({
      bookkeepingFrequency: "monthly",
      billingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      recurringServicesTemplate: [
        tline("bank_feed_management", "Bank Feed Management", 100, 1),
        tline("monthly_reporting_15", "Monthly Reporting (close by the 15th)", 25, 1),
        // A manual_edit line is a client-specific contract: overrides never touch it.
        tline("invoicing", "Invoicing (negotiated)", 80, 1, { manual_edit: true }),
        // Unpriced in the template; an override prices it at invoice time.
        tline("process_payroll", "Process Payroll", null, 2),
      ],
    });

    await setPricingOverride("bank_feed_management", 119.95, admin.id);
    await setPricingOverride("process_payroll", 40, admin.id);

    await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, client.id))
      .limit(1);
    expect(invoice).not.toBeNull();
    const lines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice!.id));
    const byKey = new Map(lines.map((l) => [l.serviceKey, l]));

    expect(byKey.get("bank_feed_management")).toMatchObject({
      unitPrice: "119.95",
      amount: "119.95",
    });
    expect(byKey.get("monthly_reporting_15")).toMatchObject({
      unitPrice: "25.00",
      amount: "25.00",
    });
    expect(byKey.get("invoicing")).toMatchObject({ unitPrice: "80.00", amount: "80.00" });
    expect(byKey.get("process_payroll")).toMatchObject({
      quantity: "2.00",
      unitPrice: "40.00",
      amount: "80.00",
    });
    // 119.95 + 25 + 80 + 80 = 304.95
    expect(invoice!.total).toBe("304.95");
  });

  it("without overrides the same fixture bills at the template prices (unchanged behavior)", async () => {
    const client = await makeClient({
      bookkeepingFrequency: "monthly",
      billingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      recurringServicesTemplate: [
        tline("bank_feed_management", "Bank Feed Management", 100, 1),
        tline("process_payroll", "Process Payroll", null, 2),
      ],
    });

    await generateMonthlyInvoices(2026, 9, TEST_TODAY);
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, client.id))
      .limit(1);
    const lines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice!.id));
    // Unpriced lines stay skipped; the priced line bills at its stored price.
    expect(lines.map((l) => l.serviceKey)).toEqual(["bank_feed_management"]);
    expect(invoice!.total).toBe("100.00");
  });
});
