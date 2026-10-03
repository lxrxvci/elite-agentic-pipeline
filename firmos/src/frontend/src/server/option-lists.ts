import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { optionListValues } from "@/db/schema";
import { logEvent } from "@/server/audit";
import { normalizeInstitutionKey } from "@/shared/lib/institution-key";

/**
 * K3 (meeting 09_30 + DB1/J1): the universal persistent-option engine. The
 * Jason rule - "anytime there's a potential database, it should be a
 * database; once added through an intake, it stays in the database for
 * future use" (09_27 00:28:42) and "if we are offering another or custom
 * option... define that further and also add that to be able to be used
 * again... across this entire platform" (09_30 00:06:12).
 *
 * One table (option_list_values) backs every reusable list; this registry
 * declares each list's key/label/noun/seeds. Every list gets the proven
 * institutions semantics for free: trim + whitespace-collapse + case-fold
 * duplicate-returns-existing, unique-index race readback, alphabetical
 * reads, admin rename/deactivate, and audited admin writes. A new reusable
 * list is ONE registry entry away - no table, no module.
 */

export interface OptionValueRow {
  id: number;
  listKey: string;
  name: string;
  meta: unknown;
  isActive: boolean;
}

export interface OptionListDef {
  /** Stable key (snake) - also the table's list_key and the URL slug. */
  key: string;
  /** Admin screen heading. */
  label: string;
  /** Singular noun for add-new copy ("source", "industry", ...). */
  noun: string;
  /** Values seeded on first use/migration-seed; the firm's starting list. */
  seeds: readonly string[];
}

/**
 * The platform's reusable lists. Intake questions reference these keys via
 * `optionsFromList`; the extraction vocabulary reads the same tables.
 */
export const OPTION_LISTS: Record<string, OptionListDef> = {
  referral_sources: {
    key: "referral_sources",
    label: "Referral sources",
    noun: "source",
    seeds: ["CPA referral", "Existing client", "Walk-in", "Web search"],
  },
  industries: {
    key: "industries",
    label: "Industries",
    noun: "industry",
    seeds: ["Construction", "Medical / therapy practice", "Real estate", "Restaurant / food service", "Retail"],
  },
  payment_methods: {
    key: "payment_methods",
    label: "Payment methods",
    noun: "method",
    seeds: ["ACH", "Cash", "Check", "Credit / debit card", "Online payments"],
  },
  property_types: {
    key: "property_types",
    label: "Property types",
    noun: "property type",
    seeds: ["Commercial", "Land", "Mixed use", "Multi-family", "Single-family"],
  },
  asset_types: {
    key: "asset_types",
    label: "Asset types",
    noun: "asset type",
    seeds: ["Equipment", "Furniture & fixtures", "Goodwill", "Investments"],
  },
  bill_pay_locations: {
    key: "bill_pay_locations",
    label: "Bill-pay locations",
    noun: "place",
    seeds: [],
  },
  report_types: {
    key: "report_types",
    label: "Special report types",
    noun: "report type",
    seeds: ["Oregon Special Report"],
  },
  contact_roles: {
    key: "contact_roles",
    label: "Contact roles",
    noun: "role",
    seeds: ["Primary contact", "Bookkeeper (client-side)", "Office manager", "Billing contact"],
  },
  custom_task_templates: {
    key: "custom_task_templates",
    label: "Custom task templates",
    noun: "task",
    seeds: [],
  },
  tax_structure_customs: {
    key: "tax_structure_customs",
    label: "Custom tax structures",
    noun: "tax structure",
    seeds: [],
  },
  accounting_software: {
    key: "accounting_software",
    label: "Accounting software",
    noun: "software",
    seeds: ["QuickBooks Online", "QuickBooks Desktop", "Xero", "Wave"],
  },
};

export class OptionListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionListError";
  }
}

/** Normalize for duplicate detection: trimmed, case-folded, single-spaced. */
const fold = normalizeInstitutionKey;

function defFor(listKey: string): OptionListDef {
  const def = OPTION_LISTS[listKey];
  if (!def) throw new OptionListError(`Unknown option list "${listKey}".`);
  return def;
}

/** Active values, alphabetical (the J3 rule - every list, always). */
export async function listOptionValues(listKey: string, includeInactive = false): Promise<OptionValueRow[]> {
  defFor(listKey);
  const where = includeInactive
    ? eq(optionListValues.listKey, listKey)
    : and(eq(optionListValues.listKey, listKey), eq(optionListValues.isActive, true));
  return db
    .select({
      id: optionListValues.id,
      listKey: optionListValues.listKey,
      name: optionListValues.name,
      meta: optionListValues.meta,
      isActive: optionListValues.isActive,
    })
    .from(optionListValues)
    .where(where)
    .orderBy(asc(optionListValues.name));
}

/**
 * Add a value to a list - the DB1/J1 write. Duplicate-safe: an exact or
 * case-folded match returns the existing row (reactivating it if an admin
 * had deactivated it), so "Umpqua" and "umpqua" never fork the list.
 */
export async function addOptionValue(listKey: string, rawName: string, userId?: number | null): Promise<OptionValueRow> {
  defFor(listKey);
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name === "") throw new OptionListError(`Give the ${OPTION_LISTS[listKey].noun} a name first.`);

  const existing = await db
    .select()
    .from(optionListValues)
    .where(and(eq(optionListValues.listKey, listKey), sql`lower(${optionListValues.name}) = ${fold(name)}`))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    if (!row.isActive) {
      await db.update(optionListValues).set({ isActive: true }).where(eq(optionListValues.id, row.id));
      return { ...row, isActive: true };
    }
    return row;
  }

  const inserted = await db
    .insert(optionListValues)
    .values({ listKey, name })
    .onConflictDoNothing({ target: [optionListValues.listKey, optionListValues.name] })
    .returning();
  if (inserted.length > 0) {
    if (userId != null) {
      await logEvent({
        userId,
        action: "option_value_added",
        entityType: "option_list",
        entityId: inserted[0].id,
        metadata: { listKey, name },
      });
    }
    return inserted[0];
  }
  const [winner] = await db
    .select()
    .from(optionListValues)
    .where(and(eq(optionListValues.listKey, listKey), sql`lower(${optionListValues.name}) = ${fold(name)}`))
    .limit(1);
  return winner;
}

/** Rename in place (audited). Answers store the name, so history follows. */
export async function renameOptionValue(listKey: string, id: number, rawName: string, userId: number): Promise<OptionValueRow> {
  defFor(listKey);
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name === "") throw new OptionListError(`Give the ${OPTION_LISTS[listKey].noun} a name first.`);
  const dupe = await db
    .select({ id: optionListValues.id })
    .from(optionListValues)
    .where(and(eq(optionListValues.listKey, listKey), sql`lower(${optionListValues.name}) = ${fold(name)}`))
    .limit(1);
  if (dupe.length > 0 && dupe[0].id !== id) {
    throw new OptionListError(`"${name}" is already on the list.`);
  }
  const rows = await db
    .update(optionListValues)
    .set({ name })
    .where(and(eq(optionListValues.id, id), eq(optionListValues.listKey, listKey)))
    .returning();
  if (rows.length === 0) throw new OptionListError("That option no longer exists.");
  await logEvent({ userId, action: "option_value_renamed", entityType: "option_list", entityId: id, metadata: { listKey, name } });
  return rows[0];
}

/** Deactivate/reactivate (audited). Inactive values stop offering but keep history. */
export async function setOptionValueActive(listKey: string, id: number, active: boolean, userId: number): Promise<OptionValueRow> {
  defFor(listKey);
  const rows = await db
    .update(optionListValues)
    .set({ isActive: active })
    .where(and(eq(optionListValues.id, id), eq(optionListValues.listKey, listKey)))
    .returning();
  if (rows.length === 0) throw new OptionListError("That option no longer exists.");
  await logEvent({
    userId,
    action: active ? "option_value_reactivated" : "option_value_deactivated",
    entityType: "option_list",
    entityId: id,
    metadata: { listKey, name: rows[0].name },
  });
  return rows[0];
}

/** Insert any missing seed values across every registered list (idempotent). */
export async function seedOptionLists(): Promise<number> {
  let added = 0;
  for (const def of Object.values(OPTION_LISTS)) {
    const existing = new Set((await listOptionValues(def.key, true)).map((v) => fold(v.name)));
    for (const name of def.seeds) {
      if (!existing.has(fold(name))) {
        await db.insert(optionListValues).values({ listKey: def.key, name }).onConflictDoNothing({
          target: [optionListValues.listKey, optionListValues.name],
        });
        added += 1;
      }
    }
  }
  return added;
}
