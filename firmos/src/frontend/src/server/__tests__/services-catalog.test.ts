import { beforeAll, describe, expect, it } from "vitest";

import { PRICING } from "@firmos/domain";

import { db } from "@/db";
import { auditEvents, servicesCatalog } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  addCustomService,
  getCustomServiceEntries,
  listServicesCatalog,
  renameService,
  seedServicesCatalog,
  ServicesCatalogError,
  setServiceActive,
  setServiceAddon,
  slugServiceKey,
} from "@/server/services-catalog";
import { calculateIntakeQuote } from "@/server/quote";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K3 (J16): the services catalog - canonical rows mirror PRICING, custom
 * services price into quotes without a deploy, and membership (standard /
 * add-on / hidden) is admin data.
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("services catalog", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    await seedServicesCatalog();
  });

  it("seeds the canonical table and mirrors it (labels, membership, pricing intact)", async () => {
    const rows = await listServicesCatalog();
    // Every canonical key is present with its PRICING name.
    for (const [key, entry] of Object.entries(PRICING)) {
      const row = rows.find((r) => r.serviceKey === key);
      expect(row, key).toBeTruthy();
      expect(row!.productName).toBe(entry.product_name);
      expect(row!.isCustom).toBe(false);
    }
    // Membership flags: the two real standards + the five add-ons.
    expect(rows.find((r) => r.serviceKey === "bank_feed_management")?.isStandard).toBe(true);
    expect(rows.find((r) => r.serviceKey === "invoicing")?.isAddon).toBe(true);
    expect(rows.find((r) => r.serviceKey === "qbo_setup")?.isAddon).toBe(false);
    // Alphabetized for the admin (J3).
    const names = rows.map((r) => r.productName);
    expect([...names]).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  it("new_addon_appears_without_deploy: a custom service prices into a quote immediately", async () => {
    const row = await addCustomService(
      {
        productName: "Weekend emergency catch-up",
        group: "other",
        unit: "month",
        unitPrice: 175,
        scaling: "flat_monthly",
        bucket: "monthly",
        isAddon: true,
      },
      1,
    );
    expect(row.serviceKey).toBe("weekend_emergency_catch-up".replace(/-/g, "_"));
    expect(row.isCustom).toBe(true);

    const entries = await getCustomServiceEntries();
    expect(entries[row.serviceKey]?.unit_price).toBe(175);

    // It prices into a quote through the domain engine like any service.
    const quote = calculateIntakeQuote(
      {
        engagementType: "bookkeeping",
        bookkeepingStartDate: "2026-08-01",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "10",
        serviceKeys: [row.serviceKey],
      },
      TEST_TODAY,
      null,
      entries,
    );
    const line = quote.lines.find((l) => l.service_key === row.serviceKey);
    expect(line).toBeTruthy();
    expect(line!.amount).toBe(175);
    expect(line!.unpriced).toBe(false);

    // Validation: canonical key collision + missing price are refused.
    await expect(
      addCustomService({ productName: "Bank Feed Management", group: "other", unit: "month", unitPrice: 5, scaling: "flat_monthly", bucket: "monthly", isAddon: false }, 1),
    ).rejects.toThrow(ServicesCatalogError);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "services_catalog"));
    expect(audit.some((e) => e.action === "service_added")).toBe(true);
  });

  it("rename and deactivate are audited admin writes; hidden customs stop pricing", async () => {
    const row = await addCustomService(
      { productName: "HOA dues entry", group: "other", unit: "month", unitPrice: 40, scaling: "flat_monthly", bucket: "monthly", isAddon: false },
      1,
    );
    await renameService(row.serviceKey, "HOA dues processing", 1);
    const renamed = (await listServicesCatalog()).find((r) => r.serviceKey === row.serviceKey);
    expect(renamed?.productName).toBe("HOA dues processing");

    await setServiceAddon(row.serviceKey, true, 1);
    await setServiceActive(row.serviceKey, false, 1);
    const entries = await getCustomServiceEntries();
    expect(entries[row.serviceKey]).toBeUndefined();
    const listed = (await listServicesCatalog()).find((r) => r.serviceKey === row.serviceKey);
    expect(listed?.isActive).toBe(false);
    expect(listed?.isAddon).toBe(true);
  });

  it("slugServiceKey normalizes names into stable keys", () => {
    expect(slugServiceKey("Custom P&L by Property")).toBe("custom_p_l_by_property");
    expect(slugServiceKey("   ")).toBe("custom_service");
  });
});
