import { asc, sql } from "drizzle-orm";

import { db } from "@/db";
import { merchantProcessors } from "@/db/schema";
import { normalizeInstitutionKey } from "@/shared/lib/institution-key";

/**
 * The firm-wide merchant-processor list (meeting #3, DB1/E4): the intake's
 * merchant question picks processors from this table, and "add a new
 * processor" writes to it inline - once added through an intake it stays in
 * the database for future use. Seeded with the firm's known processors by
 * migration 0020; admin management (rename/merge) is a deliberate later
 * seam - this module is the API that screen will use.
 */

export interface MerchantProcessorRow {
  id: number;
  name: string;
}

export class MerchantProcessorNameError extends Error {
  constructor() {
    super("Give the processor a name first.");
    this.name = "MerchantProcessorNameError";
  }
}

/** Normalize for duplicate detection: trimmed, case-folded, single-spaced. */
const fold = normalizeInstitutionKey;

/** The firm's known processors (meeting #3, E4: "Stripe, Square, QuickBooks
 *  Online, Toast..."). Migration 0020 seeds these on real databases; seed.ts
 *  re-seeds them after its full-wipe. */
export const SEED_MERCHANT_PROCESSORS: readonly string[] = [
  "Stripe",
  "Square",
  "QuickBooks Online",
  "Toast",
  "Shopify",
  "Clover",
  "Authorize.net",
  "PayPal",
];

/** Insert any missing seed processors (idempotent). */
export async function seedMerchantProcessors(): Promise<number> {
  const existing = new Set((await listMerchantProcessors()).map((p) => fold(p.name)));
  const missing = SEED_MERCHANT_PROCESSORS.filter((name) => !existing.has(fold(name)));
  if (missing.length === 0) return 0;
  await db.insert(merchantProcessors).values(missing.map((name) => ({ name })));
  return missing.length;
}

export async function listMerchantProcessors(): Promise<MerchantProcessorRow[]> {
  return db
    .select({ id: merchantProcessors.id, name: merchantProcessors.name })
    .from(merchantProcessors)
    .orderBy(asc(merchantProcessors.name));
}

/**
 * Add a processor to the shared list. Duplicate-safe: an exact or
 * case-folded name match returns the existing row instead of erroring; a
 * concurrent same-name insert loses the unique race and reads back the
 * winner.
 */
export async function addMerchantProcessor(name: string): Promise<MerchantProcessorRow> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new MerchantProcessorNameError();

  const existing = await db
    .select({ id: merchantProcessors.id, name: merchantProcessors.name })
    .from(merchantProcessors)
    .where(sql`lower(${merchantProcessors.name}) = ${fold(trimmed)}`)
    .limit(1);
  if (existing.length > 0) return existing[0];

  const inserted = await db
    .insert(merchantProcessors)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: merchantProcessors.name })
    .returning({ id: merchantProcessors.id, name: merchantProcessors.name });
  if (inserted.length > 0) return inserted[0];

  const [winner] = await db
    .select({ id: merchantProcessors.id, name: merchantProcessors.name })
    .from(merchantProcessors)
    .where(sql`lower(${merchantProcessors.name}) = ${fold(trimmed)}`)
    .limit(1);
  return winner;
}

export class MerchantProcessorRenameCollisionError extends Error {
  constructor(public readonly existingName: string) {
    super(`"${existingName}" is already on the processor list.`);
    this.name = "MerchantProcessorRenameCollisionError";
  }
}

/**
 * L2 (B3, 10_06 00:10:01): the pencil edit on the processor stack renames a
 * row in place. Fold-deduped like add: renaming onto an existing name is a
 * collision, never a merge (the J16 merge seam stays deliberate-later).
 */
export async function renameMerchantProcessor(id: number, name: string): Promise<MerchantProcessorRow> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new MerchantProcessorNameError();

  const collision = await db
    .select({ id: merchantProcessors.id, name: merchantProcessors.name })
    .from(merchantProcessors)
    .where(sql`lower(${merchantProcessors.name}) = ${fold(trimmed)}`)
    .limit(1);
  if (collision.length > 0 && collision[0].id !== id) {
    throw new MerchantProcessorRenameCollisionError(collision[0].name);
  }

  const [updated] = await db
    .update(merchantProcessors)
    .set({ name: trimmed })
    .where(sql`${merchantProcessors.id} = ${id}`)
    .returning({ id: merchantProcessors.id, name: merchantProcessors.name });
  return updated;
}
