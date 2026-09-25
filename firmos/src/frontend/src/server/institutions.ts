import { asc, sql } from "drizzle-orm";

import { db } from "@/db";
import { institutions } from "@/db/schema";

/**
 * The firm-wide bank/institution list (intake restructure I3, plan §3):
 * the intake account dropdowns pick from this table, and "add a new bank"
 * writes to it inline. Seeded with the firm's known banks by migration
 * 0017; admin management (rename/merge) is a deliberate later seam - this
 * module is the API that screen will use.
 */

export interface InstitutionRow {
  id: number;
  name: string;
}

export class InstitutionNameError extends Error {
  constructor() {
    super("Give the bank a name first.");
    this.name = "InstitutionNameError";
  }
}

/** Normalize for duplicate detection: trimmed, case-folded, single-spaced. */
const fold = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The firm's known banks (intake restructure §7 open question 2). Migration
 * 0017 seeds these on real databases; seed.ts re-seeds them after its
 * full-wipe so dev/test databases start from the same list.
 */
export const SEED_INSTITUTIONS: readonly string[] = [
  "Chase",
  "Wells Fargo",
  "Bank of America",
  "Columbia",
  "Umpqua",
  "Mr. Cooper",
  "Amex",
  "Capital One",
  "US Bank",
  "KeyBank",
];

/** Insert any missing seed banks (idempotent). */
export async function seedInstitutions(): Promise<number> {
  const existing = new Set((await listInstitutions()).map((i) => fold(i.name)));
  const missing = SEED_INSTITUTIONS.filter((name) => !existing.has(fold(name)));
  if (missing.length === 0) return 0;
  await db.insert(institutions).values(missing.map((name) => ({ name })));
  return missing.length;
}

export async function listInstitutions(): Promise<InstitutionRow[]> {
  return db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .orderBy(asc(institutions.name));
}

/**
 * Add a bank to the shared list. Duplicate-safe: an exact or case-folded
 * name match returns the existing row instead of erroring, so two intakes
 * adding "Umpqua" and "umpqua" in the same week never fork the list.
 */
export async function addInstitution(name: string): Promise<InstitutionRow> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new InstitutionNameError();

  const existing = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(sql`lower(${institutions.name}) = ${fold(trimmed)}`)
    .limit(1);
  if (existing.length > 0) return existing[0];

  // A concurrent insert with the same name loses the unique race; on the
  // conflict path we read back the winner.
  const inserted = await db
    .insert(institutions)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: institutions.name })
    .returning({ id: institutions.id, name: institutions.name });
  if (inserted.length > 0) return inserted[0];

  const [winner] = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(sql`lower(${institutions.name}) = ${fold(trimmed)}`)
    .limit(1);
  return winner;
}
