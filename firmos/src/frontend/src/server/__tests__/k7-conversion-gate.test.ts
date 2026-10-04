import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { accountItemError, ACCOUNT_COUNT_DEFS } from "@/components/intake/registry";
import { convertIntakeToClient, ConversionError } from "@/server/convert";
import { createIntake, submitIntakeForReview, updateIntake, type IntakePatch } from "@/server/intake";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K7 (C1/J5, 09_30 00:13:10-00:17:06): identifiers are optional during the
 * discovery call and mandatory at conversion - "the last four digits should
 * be optional until it's converted to a client then it becomes mandatory."
 */

describe("C1: optional at intake, mandatory at conversion", () => {
  const checking = ACCOUNT_COUNT_DEFS.find((d) => d.answerKey === "checkingAccounts")!

  it("intake_allows_missing_last4: no bank/last4 is fine during discovery", () => {
    expect(accountItemError(checking, [{ name: '', accountType: "checking", proofCategory: "statement" }])).toBeNull()
    expect(accountItemError(checking, [])).toBeNull()
    // Structural guards stay: vehicles still need the financed/paid pick.
    const vehicles = ACCOUNT_COUNT_DEFS.find((d) => d.answerKey === "vehicleAssets")!
    expect(accountItemError(vehicles, [{ accountType: "vehicle", name: "Ford Transit" }])).toMatch(/financed or paid/)
  })
})

const reachable = await dbReachable();

describe.skipIf(!reachable)("C1: the conversion gate (DB)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("conversion_gate_blocks_with_fix_links: missing identifiers refuse conversion in plain language", async () => {
    const patch: IntakePatch = {
      legalName: "Gate Test LLC",
      formData: {
        contacts: [{ firstName: "Wren", lastName: "Okafor", isPrimary: true, relationshipType: "primary_contact" }],
        taxStructure: "LLC",
        llcSubclass: "llc_sml",
        engagementType: "consulting",
        accounts: [
          { name: "Main checking", accountType: "checking", proofCategory: "statement" }, // no bank, no last4
        ],
      },
    } as IntakePatch;
    const row = await createIntake(patch);
    await updateIntake(row.id, {});
    await submitIntakeForReview(row.id);

    const mgr = (await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1))[0];
    const err = await convertIntakeToClient(row.id, { managerId: mgr.id }, mgr.id, TEST_TODAY).catch((e) => e);
    expect(err).toBeInstanceOf(ConversionError);
    expect(String(err.message)).toContain("pick the bank");
    expect(String(err.message)).toContain("last 4 digits");
  });

  it("a complete intake converts past the gate", async () => {
    const patch: IntakePatch = {
      legalName: "Gate Pass LLC",
      formData: {
        contacts: [{ firstName: "Wren", lastName: "Okafor", isPrimary: true, relationshipType: "primary_contact" }],
        taxStructure: "LLC",
        llcSubclass: "llc_sml",
        engagementType: "consulting",
        accounts: [
          { name: "Main checking", accountType: "checking", proofCategory: "statement", institution: "Chase", last4: "4411" },
        ],
      },
    } as IntakePatch;
    const row = await createIntake(patch);
    await updateIntake(row.id, {});
    await submitIntakeForReview(row.id);
    const mgr = (await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1))[0];
    const result = await convertIntakeToClient(row.id, { managerId: mgr.id }, mgr.id, TEST_TODAY);
    expect(result.clientId).toBeGreaterThan(0);
  });
});

describe.skipIf(!reachable)("C3: asset-driven onboarding tasks (09_30 00:17:55)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("bill_of_sale_creates_document_request + owner_declared_creates_value_checklist", async () => {
    const patch: IntakePatch = {
      legalName: "Asset Task Co",
      formData: {
        contacts: [{ firstName: "Wren", lastName: "Okafor", isPrimary: true, relationshipType: "primary_contact" }],
        taxStructure: "LLC",
        llcSubclass: "llc_sml",
        engagementType: "consulting",
        accounts: [
          { name: "2022 Ford Transit", accountType: "vehicle", proofCategory: "bill_of_sale" },
          { name: "Espresso machine", accountType: "fixed_assets", proofCategory: "owner_declared" },
        ],
      },
    } as IntakePatch;
    const row = await createIntake(patch);
    await updateIntake(row.id, {});
    await submitIntakeForReview(row.id);
    const mgr = (await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1))[0];
    const result = await convertIntakeToClient(row.id, { managerId: mgr.id }, mgr.id, TEST_TODAY);

    const created = await db.select().from(tasks).where(eq(tasks.clientId, result.clientId));
    const titles = created.map((t) => t.title);
    expect(titles).toContain("Request the bill of sale: 2022 Ford Transit");
    expect(titles).toContain("Collect the owner's numbers: Espresso machine");
    const bos = created.find((t) => t.title.startsWith("Request the bill of sale"))!;
    expect(bos.description).toContain("bill of sale");
  });
});
