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
  PROOF_CATEGORIES,
  proofCategoryFor,
  statementDayForIntakeAccount,
  type AccountTypeDefinition,
  type ProofCategory,
  type RequiredDocumentMode,
} from "@/shared/lib/account-types";

import {
  accountTypeDefinition,
  DEFAULT_SEED_ACCOUNT_TYPES,
} from "@/shared/lib/account-types";

/** Database handle: the global client or a transaction scope. */
export type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

/**
 * seedDefaultAccounts - inserts the default seed accounts for a new client.
 * Runs inside the caller's transaction when one is passed (conversion does,
 * so a failure there cannot leave accounts behind without the client).
 */
export async function seedDefaultAccounts(
  clientId: number,
  opts: { openDate?: string | null; types?: readonly string[] } = {},
  dbOrTx: DbOrTx = db,
): Promise<(typeof accounts.$inferSelect)[]> {
  const keys = opts.types ?? DEFAULT_SEED_ACCOUNT_TYPES;
  const values = keys
    .map((key) => {
      const definition = accountTypeDefinition(key);
      if (!definition) throw new Error(`seedDefaultAccounts: unknown account type: ${key}`);
      return {
        clientId,
        name: definition.label,
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
