import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  addMerchantProcessor,
  listMerchantProcessors,
  MerchantProcessorNameError,
  SEED_MERCHANT_PROCESSORS,
} from "@/server/merchant-processors";
import {
  addPayrollProvider,
  listPayrollProviders,
  PayrollProviderNameError,
  SEED_PAYROLL_PROVIDERS,
} from "@/server/payroll-providers";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

/**
 * J1 (meeting #3, DB1/P2/E4): the payroll_providers and merchant_processors
 * tables behind the intake's provider dropdown and processor picks - seeded
 * by migration 0020, written inline by add-new. "Anytime there's a potential
 * database, it should be a database; once added through an intake, it stays."
 */
describe.skipIf(!reachable)("payroll providers + merchant processors (J1, DB1)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("the migration seeded both lists (and seed.ts restores them after a wipe)", async () => {
    const migration = readFileSync(
      path.resolve(__dirname, "../../../drizzle/0020_lumpy_selene.sql"),
      "utf8",
    );
    const providers = (await listPayrollProviders()).map((p) => p.name);
    const processors = (await listMerchantProcessors()).map((p) => p.name);
    for (const expected of SEED_PAYROLL_PROVIDERS) {
      expect(providers).toContain(expected);
      expect(migration).toContain(`('${expected}')`);
    }
    for (const expected of SEED_MERCHANT_PROCESSORS) {
      expect(processors).toContain(expected);
      expect(migration).toContain(`('${expected}')`);
    }
  });

  it("provider add-new persists and appears in the same session's list, deduped case-insensitively", async () => {
    const created = await addPayrollProvider("  Sure  Payroll ");
    expect(created.name).toBe("Sure Payroll");

    // Same-session visibility: the very next list carries it.
    const names = (await listPayrollProviders()).map((p) => p.name);
    expect(names).toContain("Sure Payroll");

    // Case-folded duplicate returns the existing row - never a second one.
    const dupe = await addPayrollProvider("sure payroll");
    expect(dupe.id).toBe(created.id);
    expect(names.filter((n) => n === "Sure Payroll")).toHaveLength(1);

    await expect(addPayrollProvider("   ")).rejects.toBeInstanceOf(PayrollProviderNameError);
  });

  it("processor add-new persists and appears in the same session's list, deduped case-insensitively", async () => {
    const created = await addMerchantProcessor("Helcim");
    const names = (await listMerchantProcessors()).map((p) => p.name);
    expect(names).toContain("Helcim");

    const dupe = await addMerchantProcessor("  helcim ");
    expect(dupe.id).toBe(created.id);
    expect(
      (await listMerchantProcessors()).map((p) => p.name).filter((n) => n === "Helcim"),
    ).toHaveLength(1);

    await expect(addMerchantProcessor("")).rejects.toBeInstanceOf(MerchantProcessorNameError);
  });
});
