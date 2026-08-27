import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { PRICING } from "@firmos/domain";

import { db } from "@/db";
import { clientIntakes, clients, contacts, intakeOwners } from "@/db/schema";
import { ConversionError, convertIntakeToClient } from "@/server/convert";
import {
  archiveIntake,
  createIntake,
  deleteIntake,
  findDuplicates,
  getIntake,
  IntakeConvertedError,
  IntakeStatusError,
  submitIntakeForReview,
  updateIntake,
} from "@/server/intake";
import { calculateIntakeQuote } from "@/server/quote";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

async function freshIntake(legalName: string): Promise<number> {
  const row = await createIntake({ legalName });
  return row.id;
}

describe.skipIf(!reachable)("intake lifecycle and duplicate detection", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("walks the happy path and stamps submitted_at", async () => {
    const id = await freshIntake("Lifecycle Test Co");
    expect((await getIntake(id)).status).toBe("new");

    await updateIntake(id, { industry: "Landscaping" });
    const submitted = await submitIntakeForReview(id);
    expect(submitted.status).toBe("pending_review");
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.industry).toBe("Landscaping");
  });

  it("rejects illegal transitions", async () => {
    // Conversion requires the review queue: new -> completed is blocked.
    const id = await freshIntake("Illegal Transition Co");
    await expect(
      convertIntakeToClient(id, { managerId: 1, bookkeeperId: 2 }, 1, TEST_TODAY),
    ).rejects.toThrow(ConversionError);

    // archived has no exits.
    const archivedId = await freshIntake("No Exits Co");
    await archiveIntake(archivedId);
    await expect(submitIntakeForReview(archivedId)).rejects.toThrow(IntakeStatusError);
  });

  it("autosave patches structured columns and shallow-merges form_data", async () => {
    const id = await freshIntake("Autosave Co");
    await updateIntake(id, { formData: { serviceKeys: ["bank_feed_management"] } });
    await updateIntake(id, {
      accountingMethod: "accrual",
      formData: { qboClassNames: ["A", "B"] },
    });
    const row = await getIntake(id);
    expect(row.accountingMethod).toBe("accrual");
    const form = row.formData as Record<string, unknown>;
    expect(form.serviceKeys).toEqual(["bank_feed_management"]);
    expect(form.qboClassNames).toEqual(["A", "B"]);
  });

  it("mirrors owners into intake_owners on create and update", async () => {
    const id = await freshIntake("Owner Mirror Co");
    await updateIntake(id, {
      owners: [
        { name: "Ada Lovelace", email: "ada@example.com", ownershipPercent: 55 },
        { name: "Alan Turing", ownershipPercent: 45 },
      ],
    });
    let owners = await db.select().from(intakeOwners).where(eq(intakeOwners.intakeId, id));
    expect(owners).toHaveLength(2);
    expect(owners[0].ownershipPercent).toBe("55.00");

    await updateIntake(id, { owners: [{ name: "Ada Lovelace", ownershipPercent: 100 }] });
    owners = await db.select().from(intakeOwners).where(eq(intakeOwners.intakeId, id));
    expect(owners).toHaveLength(1);
  });

  it("archives a pending intake but refuses to archive or delete a converted one", async () => {
    const id = await freshIntake("Archive Me Co");
    await submitIntakeForReview(id);
    const archived = await archiveIntake(id);
    expect(archived.status).toBe("archived");
    await expect(updateIntake(id, { industry: "Nope" })).rejects.toThrow(IntakeStatusError);
    await deleteIntake(id);
    await expect(getIntake(id)).rejects.toThrow();

    const [converted] = await db
      .select()
      .from(clientIntakes)
      .where(eq(clientIntakes.legalName, "Harborline Marine Supply"))
      .limit(1);
    expect(converted.clientId).not.toBeNull();
    await expect(archiveIntake(converted.id)).rejects.toThrow(IntakeConvertedError);
    await expect(deleteIntake(converted.id)).rejects.toThrow(IntakeConvertedError);
  });

  // ── Duplicate detection (§29) ──

  it("matches an exact EIN after digit-only normalization", async () => {
    await db
      .update(clients)
      .set({ taxId: "12-3456789" })
      .where(eq(clients.legalName, "Harborline Marine Supply"));

    const hits = await findDuplicates({ taxId: "123456789" });
    expect(hits).toHaveLength(1);
    expect(hits[0].legalName).toBe("Harborline Marine Supply");
    expect(hits[0].matchedOn).toBe("tax_id");
  });

  it("matches legal and DBA names case-insensitively and trimmed", async () => {
    await db
      .update(clients)
      .set({ dbaName: "Harborline" })
      .where(eq(clients.legalName, "Harborline Marine Supply"));

    const byLegal = await findDuplicates({ legalName: "  harborline marine SUPPLY " });
    expect(byLegal.map((h) => h.legalName)).toContain("Harborline Marine Supply");

    const byDba = await findDuplicates({ legalName: "HARBORLINE" });
    expect(byDba.map((h) => h.legalName)).toContain("Harborline Marine Supply");
  });

  it("does NOT match deactivated clients (§29 fix)", async () => {
    const [ghost] = await db
      .insert(clients)
      .values({ legalName: "Ghost Client LLC", taxId: "99-9999999", isActive: false })
      .returning();

    expect(await findDuplicates({ legalName: "ghost client llc" })).toEqual([]);
    expect(await findDuplicates({ taxId: "99-999-9999" })).toEqual([]);

    await db.delete(clients).where(eq(clients.id, ghost.id));
  });

  it("does NOT match on phone numbers at all (§29 fix)", async () => {
    // A contact sharing a phone-like string with the query must not matter:
    // findDuplicates has no phone input and never looks at contacts.
    await db.insert(contacts).values({
      type: "individual",
      firstName: "Phone",
      lastName: "Twin",
      phone: "555-0142",
    });
    const hits = await findDuplicates({ legalName: "Totally Different Name", taxId: "5550142" });
    expect(hits).toEqual([]);
  });

  // ── Quote mapping sanity (domain PRICING) ──

  it("maps wizard answers to the domain quote with per-account exclusions", () => {
    const quote = calculateIntakeQuote({
      bookkeepingFrequency: "monthly",
      serviceKeys: [
        "bank_feed_management",
        "account_reconciliations",
        "monthly_reporting_10",
        "1099_per_filing",
      ],
      accounts: [
        { name: "Checking", accountType: "checking" },
        { name: "Savings", accountType: "savings" },
        // Loan types are excluded from the per-account count (§6.5).
        { name: "Van Loan", accountType: "vehicle_loan" },
        // Owner-documented: no statement day, excluded.
        { name: "Owner Draws", accountType: "owner_distributions" },
      ],
      merchantAccounts: [{ name: "Stripe", processor: "Stripe" }],
      estimated1099Count: 4,
    });

    const recon = quote.lines.find((l) => l.service_key === "account_reconciliations");
    expect(recon?.quantity).toBe(2);
    expect(recon?.amount).toBe(2 * PRICING.account_reconciliations.unit_price!);

    const feeds = quote.lines.find((l) => l.service_key === "bank_feed_management");
    expect(feeds?.amount).toBe(PRICING.bank_feed_management.unit_price);

    const filings = quote.lines.find((l) => l.service_key === "1099_per_filing");
    expect(filings?.quantity).toBe(4);
    expect(filings?.amount).toBe(40);

    // monthly: 100 + 50 + 50 = 200 monthly bucket + $40 February-billed annual.
    expect(quote.totals.totalMonthly).toBe(200);
    expect(quote.totals.totalFebruaryBilledAnnual).toBe(40);
    expect(quote.totals.effectiveMonthly).toBe(200);
  });

  it("scales flat quantities by the billing cycle derived from cadence", () => {
    const quote = calculateIntakeQuote({
      bookkeepingFrequency: "quarterly",
      serviceKeys: ["bank_feed_management"],
    });
    expect(quote.billingCycle).toBe(3);
    const feeds = quote.lines.find((l) => l.service_key === "bank_feed_management");
    expect(feeds?.quantity).toBe(3);
    expect(feeds?.amount).toBe(300);
    expect(quote.totals.effectiveMonthly).toBe(100);
  });
});
