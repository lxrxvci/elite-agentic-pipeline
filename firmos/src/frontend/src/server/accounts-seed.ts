import { db } from "@/db";
import { accounts } from "@/db/schema";

/**
 * accounts-seed - the db-backed half of the §15 accounts seed (inserting the
 * default accounts for a converted client). The pure account-type tables and
 * proof/statement-day rules moved to shared/lib/account-types (J4: the
 * intake review's estimate breakdowns share them client-side); they are
 * re-exported here so existing server imports keep working.
 */

export {
  ACCOUNT_TYPE_DEFINITIONS,
  accountTypeDefinition,
  DEFAULT_SEED_ACCOUNT_TYPES,
  defaultStatementDayFor,
  equitySeedPlan,
  PROOF_CATEGORIES,
  proofCategoryFor,
  statementDayForIntakeAccount,
  type AccountTypeDefinition,
  type EquitySeedRow,
  type ProofCategory,
  type RequiredDocumentMode,
} from "@/shared/lib/account-types";

import {
  accountTypeDefinition,
  DEFAULT_SEED_ACCOUNT_TYPES,
} from "@/shared/lib/account-types";

/** Database handle: the global client or a transaction scope. */
export type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

/** A seed row with an optional custom name (L5/J3: per-owner equity rows
 *  like "Owner Contributions - Wren Okafor" share one account type). */
export interface SeedAccountRow {
  type: string;
  name?: string;
}

/**
 * seedDefaultAccounts - inserts the default seed accounts for a new client.
 * Runs inside the caller's transaction when one is passed (conversion does,
 * so a failure there cannot leave accounts behind without the client).
 *
 * L5 (J3): `rows` replaces the §6.8 default pair outright (the intake's
 * equity setup decides the equity seeds); a row's `name` overrides the
 * type's label.
 */
export async function seedDefaultAccounts(
  clientId: number,
  opts: { openDate?: string | null; types?: readonly string[]; rows?: readonly SeedAccountRow[] } = {},
  dbOrTx: DbOrTx = db,
): Promise<(typeof accounts.$inferSelect)[]> {
  const rows: readonly SeedAccountRow[] =
    opts.rows ?? (opts.types ?? DEFAULT_SEED_ACCOUNT_TYPES).map((type) => ({ type }));
  const values = rows
    .map((row) => {
      const definition = accountTypeDefinition(row.type);
      if (!definition) throw new Error(`seedDefaultAccounts: unknown account type: ${row.type}`);
      return {
        clientId,
        name: row.name ?? definition.label,
        accountType: definition.key,
        statementDay: definition.defaultStatementDay,
        // I3: owner-documented seeds are owner-declared proof (the column
        // default is statement).
        proofCategory: definition.requiredDocument === "statement" ? ("statement" as const) : ("owner_declared" as const),
        openDate: opts.openDate ?? null,
      };
    });
  if (values.length === 0) return [];
  return dbOrTx.insert(accounts).values(values).returning();
}
