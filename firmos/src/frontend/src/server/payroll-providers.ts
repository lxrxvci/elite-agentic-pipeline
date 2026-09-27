import { asc, sql } from "drizzle-orm";

import { db } from "@/db";
import { payrollProviders } from "@/db/schema";
import { normalizeInstitutionKey } from "@/shared/lib/institution-key";

/**
 * The firm-wide payroll-provider list (meeting #3, DB1/P2): the intake's
 * payroll-provider question picks from this table, and "add a new provider"
 * writes to it inline - anything reusable persists globally. Seeded with the
 * mainstream providers by migration 0020; admin management (rename/merge)
 * is a deliberate later seam - this module is the API that screen will use.
 */

export interface PayrollProviderRow {
  id: number;
  name: string;
}

export class PayrollProviderNameError extends Error {
  constructor() {
    super("Give the payroll provider a name first.");
    this.name = "PayrollProviderNameError";
  }
}

/** Normalize for duplicate detection: trimmed, case-folded, single-spaced. */
const fold = normalizeInstitutionKey;

/** The mainstream providers (meeting #3, P2). Migration 0020 seeds these on
 *  real databases; seed.ts re-seeds them after its full-wipe so dev/test
 *  databases start from the same list. */
export const SEED_PAYROLL_PROVIDERS: readonly string[] = [
  "Gusto",
  "ADP",
  "QuickBooks Payroll",
  "Square Payroll",
  "OnPay",
  "Rippling",
  "Paychex",
];

/** Insert any missing seed providers (idempotent). */
export async function seedPayrollProviders(): Promise<number> {
  const existing = new Set((await listPayrollProviders()).map((p) => fold(p.name)));
  const missing = SEED_PAYROLL_PROVIDERS.filter((name) => !existing.has(fold(name)));
  if (missing.length === 0) return 0;
  await db.insert(payrollProviders).values(missing.map((name) => ({ name })));
  return missing.length;
}

export async function listPayrollProviders(): Promise<PayrollProviderRow[]> {
  return db
    .select({ id: payrollProviders.id, name: payrollProviders.name })
    .from(payrollProviders)
    .orderBy(asc(payrollProviders.name));
}

/**
 * Add a provider to the shared list. Duplicate-safe: an exact or case-folded
 * name match returns the existing row instead of erroring, so two intakes
 * adding "Gusto" and "gusto" in the same week never fork the list.
 */
export async function addPayrollProvider(name: string): Promise<PayrollProviderRow> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new PayrollProviderNameError();

  const existing = await db
    .select({ id: payrollProviders.id, name: payrollProviders.name })
    .from(payrollProviders)
    .where(sql`lower(${payrollProviders.name}) = ${fold(trimmed)}`)
    .limit(1);
  if (existing.length > 0) return existing[0];

  // A concurrent insert with the same name loses the unique race; on the
  // conflict path we read back the winner.
  const inserted = await db
    .insert(payrollProviders)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: payrollProviders.name })
    .returning({ id: payrollProviders.id, name: payrollProviders.name });
  if (inserted.length > 0) return inserted[0];

  const [winner] = await db
    .select({ id: payrollProviders.id, name: payrollProviders.name })
    .from(payrollProviders)
    .where(sql`lower(${payrollProviders.name}) = ${fold(trimmed)}`)
    .limit(1);
  return winner;
}
