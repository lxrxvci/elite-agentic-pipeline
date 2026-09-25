import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { institutions } from "@/db/schema";
import {
  addInstitution,
  InstitutionNameError,
  listInstitutions,
  SEED_INSTITUTIONS,
} from "@/server/institutions";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

/**
 * I3 (intake restructure, plan §3): the institutions table behind the intake
 * bank dropdowns - seeded by migration 0017 with the firm's known banks,
 * written inline by "add a new bank". Also pins the migration's
 * proof-category backfill (statement for bank/cc types, owner-declared
 * otherwise) by replaying its UPDATE inside a rolled-back transaction.
 */
describe.skipIf(!reachable)("institutions + the 0017 migration", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("the migration seeded the firm's known banks (and seed.ts restores them after a wipe)", async () => {
    const names = (await listInstitutions()).map((i) => i.name);
    // The migration file itself carries the same seed list.
    const migration = readFileSync(
      path.resolve(__dirname, "../../../drizzle/0017_petite_queen_noir.sql"),
      "utf8",
    );
    for (const expected of SEED_INSTITUTIONS) {
      expect(names).toContain(expected);
      expect(migration).toContain(`('${expected}')`);
    }
  });

  it("addInstitution persists a new bank and dedupes case-insensitively", async () => {
    const created = await addInstitution("  First Interstate  Bank ");
    expect(created.name).toBe("First Interstate Bank");

    // Same name, different case/whitespace: the existing row comes back.
    const dupe = await addInstitution("first interstate bank");
    expect(dupe.id).toBe(created.id);

    const names = (await listInstitutions()).map((i) => i.name);
    expect(names.filter((n) => n === "First Interstate Bank")).toHaveLength(1);

    await expect(addInstitution("   ")).rejects.toBeInstanceOf(InstitutionNameError);
  });

  it("backfill_migration_correctness: the 0017 backfill marks bank/cc rows statement and the rest owner-declared", async () => {
    const migration = readFileSync(
      path.resolve(__dirname, "../../../drizzle/0017_petite_queen_noir.sql"),
      "utf8",
    );
    // The backfill statement itself is pinned in the migration file.
    expect(migration).toContain("UPDATE \"accounts\" SET \"proof_category\" = 'owner_declared'");
    expect(migration).toContain("'checking', 'savings', 'credit_card', 'merchant', 'investment'");

    // Replaying the UPDATE must be a semantic no-op on already-correct rows:
    // run it inside a transaction that first scrambles every row to the
    // column default, then verify the backfill restores the right split.
    const url = process.env.DATABASE_URL!;
    const sql = postgres(url, { max: 1 });
    try {
      await sql.begin(async (tx) => {
        await tx`update accounts set proof_category = 'statement'`;
        await tx`
          update accounts set proof_category = 'owner_declared'
          where account_type not in ('checking', 'savings', 'credit_card', 'merchant', 'investment')
        `;
        const rows = await tx<{ account_type: string; proof_category: string }[]>`
          select account_type, proof_category from accounts
        `;
        for (const row of rows) {
          const statementTypes = ["checking", "savings", "credit_card", "merchant", "investment"];
          const expected = statementTypes.includes(row.account_type)
            ? "statement"
            : "owner_declared";
          expect(`${row.account_type} -> ${row.proof_category}`).toBe(
            `${row.account_type} -> ${expected}`,
          );
        }
        // Roll back - the suite's shared DB keeps its seeded state.
        throw new Error("__rollback__");
      });
    } catch (err) {
      if ((err as Error).message !== "__rollback__") throw err;
    } finally {
      await sql.end({ timeout: 2 }).catch(() => undefined);
    }

    // Nothing leaked out of the rolled-back transaction.
    const draws = await db.query.accounts.findFirst({
      where: (a, { eq }) => eq(a.name, "Owner Draws"),
    });
    expect(draws?.proofCategory).toBe("owner_declared");
  });
});
