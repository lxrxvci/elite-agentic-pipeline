import { and, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientIntakes, clients, intakeOwners } from "@/db/schema";

/**
 * Intake CRUD + lifecycle (HANDOFF §6.8, routes_intake.py).
 *
 * Statuses: new -> in_progress -> pending_review ("purgatory") -> completed,
 * with archived as a side exit. A converted intake cannot be deleted and has
 * no further transitions; it stays editable, and edits propagate through
 * cascadeIntakeToClient (src/server/cascade.ts).
 *
 * The structured columns carry the cascade-relevant fields; the full
 * seven-step wizard payload lives in form_data (§10). Autosave patches both.
 */

// ── Wizard payload shape (form_data) ──────────────────────────────────────

export interface IntakeOwnerInput {
  name: string;
  email?: string | null;
  ownershipPercent?: number | null;
}

export interface IntakeContactInput {
  firstName?: string | null;
  lastName?: string | null;
  entityName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Exactly one primary contact becomes the client's primary_contact. */
  isPrimary?: boolean;
  relationshipType?: "owner" | "primary_contact" | "cpa" | "related";
}

export interface IntakeAccountInput {
  name: string;
  accountType: string;
  institution?: string | null;
  /** Explicit override; null/undefined falls back to the type default (§15). */
  statementDay?: number | null;
  openDate?: string | null;
  requiresManualTransactions?: boolean;
}

/** §29 fix: merchant accounts keep every field and never collapse to one. */
export interface IntakeMerchantAccountInput {
  name: string;
  processor?: string | null;
}

export interface IntakeReportDefinition {
  name: string;
  frequency: string;
}

export interface IntakeCustomRuleInput {
  title: string;
  description?: string | null;
  scheduleType: "daily" | "weekly" | "monthly" | "quarterly" | "semi_annual" | "annual";
  daysOfWeek?: string | null;
  dayOfMonth?: number | null;
  weekday?: number | null;
  weekOfMonth?: number | null;
  anchorMonth?: number | null;
  isBillable?: boolean;
  unitPrice?: string | number | null;
  subtasks?: string[];
}

export interface IntakeCustomItemInput {
  productName: string;
  unitPrice: number;
  frequency: "weekly" | "daily" | "monthly" | "quarterly" | "semi_annual";
  quantity?: number;
}

/** Per-account pre-conversion overrides, keyed by account name (§6.8). */
export type IntakeAccountOverrides = Record<
  string,
  { statementDay?: number | null; requiresManualTransactions?: boolean }
>;

/**
 * The seven-step wizard payload (§10). The structured columns on
 * client_intakes duplicate the cascade-relevant parts; everything else the
 * wizard collects lives here so the UI can render it back verbatim.
 */
export interface IntakeFormData {
  // Step 1 - business and contacts
  serviceKeys?: string[];
  /** Explicit unit counts per service key (accounts, classes, filings, ...). */
  serviceQuantities?: Record<string, number>;
  customItems?: IntakeCustomItemInput[];
  owners?: IntakeOwnerInput[];
  contacts?: IntakeContactInput[];
  referralSource?: string | null;
  // Step 2 - starting point
  isExistingClient?: boolean;
  engagementType?: "bookkeeping" | "project";
  quickbooksStatus?: string | null;
  needsQuickbooksSetup?: boolean;
  /** Seats needed in QuickBooks; drives the tier recommendation (§15 QBO pass-through). */
  qboUserCount?: number | null;
  /** Explicit plan pick; null/absent means the quote recommends from the matrix. */
  qboSubscriptionTier?: "simple_start" | "essentials" | "plus" | "advanced" | null;
  bookkeepingStartDate?: string | null;
  bankFeedCatchupDate?: string | null;
  // Step 3 - balance sheet
  accounts?: IntakeAccountInput[];
  accountOverrides?: IntakeAccountOverrides;
  // Step 3b - real estate (owner walkthrough: yes/no, count, types,
  // depreciation buckets; conversion creates one property row per count)
  isRealEstateClient?: boolean;
  propertyCount?: number | null;
  propertyTypes?: string[];
  /** Canonical §20 depreciation field keys (land_value, building_value, ...). */
  depreciationTracking?: string[];
  // Step 4 - income and expenses
  merchantAccounts?: IntakeMerchantAccountInput[];
  paymentMethods?: string[];
  payrollFrequency?: "weekly" | "biweekly" | "semi_monthly" | "monthly";
  // Step 5 - reporting and payroll
  bookkeepingFrequency?: string | null;
  billingFrequency?: string | null;
  monthlyCloseTier?: string | null;
  accountingMethod?: string | null;
  payrollProvider?: string | null;
  reportDefinitions?: IntakeReportDefinition[];
  estimated1099Count?: number | null;
  include1099Collection?: boolean;
  include1099FullManagement?: boolean;
  includeMerchantReconciliation?: boolean;
  qboClassNames?: string[];
  qboLocationNames?: string[];
  // Step 6 - recurring and notes
  customRecurringRules?: IntakeCustomRuleInput[];
  internalNotes?: string | null;
  // Billing modifiers carried through conversion (§6.5)
  monthlyRecurringAmount?: string | number | null;
  baseMonthlyAmount?: string | number | null;
  perAccountPrice?: string | number | null;
  // The wizard evolves faster than this type; unknown keys round-trip.
  [key: string]: unknown;
}

export type IntakeRow = typeof clientIntakes.$inferSelect;
export type IntakeStatus = IntakeRow["status"];

// ── Status machine (§6.8) ─────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<IntakeStatus, readonly IntakeStatus[]> = {
  new: ["in_progress", "pending_review", "archived"],
  in_progress: ["new", "pending_review", "archived"],
  pending_review: ["in_progress", "completed", "archived"],
  // Converted intakes have no transitions; archive is a pre-completion exit.
  completed: [],
  archived: [],
};

export class IntakeStatusError extends Error {
  constructor(
    public readonly from: IntakeStatus,
    public readonly to: IntakeStatus,
  ) {
    super(`intake cannot move from ${from} to ${to}`);
    this.name = "IntakeStatusError";
  }
}

export function assertIntakeTransition(from: IntakeStatus, to: IntakeStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IntakeStatusError(from, to);
  }
}

export class IntakeConvertedError extends Error {
  constructor(intakeId: number) {
    super(`intake ${intakeId} has been converted and cannot be deleted or archived`);
    this.name = "IntakeConvertedError";
  }
}

export class IntakeNotFoundError extends Error {
  constructor(intakeId: number) {
    super(`intake not found: ${intakeId}`);
    this.name = "IntakeNotFoundError";
  }
}

export async function getIntake(intakeId: number): Promise<IntakeRow> {
  const [row] = await db.select().from(clientIntakes).where(eq(clientIntakes.id, intakeId)).limit(1);
  if (!row) throw new IntakeNotFoundError(intakeId);
  return row;
}

// ── Create / update (autosave) ────────────────────────────────────────────

export interface IntakePatch {
  legalName?: string;
  dbaName?: string | null;
  taxStructure?: string | null;
  taxId?: string | null;
  industry?: string | null;
  referralSource?: string | null;
  businessAddress?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessZip?: string | null;
  isExistingClient?: boolean;
  engagementType?: string | null;
  quickbooksStatus?: string | null;
  needsQuickbooksSetup?: boolean;
  bookkeepingStartDate?: string | null;
  bankFeedCatchupDate?: string | null;
  bookkeepingFrequency?: IntakeRow["bookkeepingFrequency"];
  billingFrequency?: IntakeRow["billingFrequency"];
  monthlyCloseTier?: IntakeRow["monthlyCloseTier"];
  accountingMethod?: string | null;
  payrollProvider?: string | null;
  managerId?: number | null;
  bookkeeperId?: number | null;
  monthlyRecurringAmount?: string | number | null;
  baseMonthlyAmount?: string | number | null;
  perAccountPrice?: string | number | null;
  reportDefinitions?: IntakeReportDefinition[];
  customRecurringRules?: IntakeCustomRuleInput[];
  /** Shallow-merged into the stored form_data (autosave sends step slices). */
  formData?: IntakeFormData;
  internalNotes?: string | null;
  /** Full owner list replacement; mirrors into intake_owners. */
  owners?: IntakeOwnerInput[];
}

/** Structured columns a patch may set directly. */
const COLUMN_KEYS = [
  "legalName",
  "dbaName",
  "taxStructure",
  "taxId",
  "industry",
  "referralSource",
  "businessAddress",
  "businessCity",
  "businessState",
  "businessZip",
  "isExistingClient",
  "engagementType",
  "quickbooksStatus",
  "needsQuickbooksSetup",
  "bookkeepingStartDate",
  "bankFeedCatchupDate",
  "bookkeepingFrequency",
  "billingFrequency",
  "monthlyCloseTier",
  "accountingMethod",
  "payrollProvider",
  "managerId",
  "bookkeeperId",
  "monthlyRecurringAmount",
  "baseMonthlyAmount",
  "perAccountPrice",
  "reportDefinitions",
  "customRecurringRules",
  "internalNotes",
] as const;

type ColumnKey = (typeof COLUMN_KEYS)[number];
type IntakeInsert = typeof clientIntakes.$inferInsert;

function columnPatch(patch: IntakePatch): Partial<IntakeInsert> {
  const out: Record<string, unknown> = {};
  for (const key of COLUMN_KEYS) {
    if (key in patch) out[key] = patch[key as keyof IntakePatch];
  }
  return out as Partial<Record<ColumnKey, unknown>> as Partial<IntakeInsert>;
}

function moneyOrNull(value: string | number | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

async function replaceIntakeOwners(intakeId: number, owners: IntakeOwnerInput[]): Promise<void> {
  // Preserve contact_id (set at conversion) for owners that survive the edit.
  const existing = await db.select().from(intakeOwners).where(eq(intakeOwners.intakeId, intakeId));
  const contactIdByName = new Map(
    existing.filter((o) => o.contactId != null).map((o) => [o.name.trim().toLowerCase(), o.contactId]),
  );
  await db.delete(intakeOwners).where(eq(intakeOwners.intakeId, intakeId));
  if (owners.length === 0) return;
  await db.insert(intakeOwners).values(
    owners.map((o) => ({
      intakeId,
      name: o.name,
      email: o.email ?? null,
      ownershipPercent: o.ownershipPercent == null ? null : String(o.ownershipPercent),
      contactId: contactIdByName.get(o.name.trim().toLowerCase()) ?? null,
    })),
  );
}

export async function createIntake(patch: IntakePatch): Promise<IntakeRow> {
  if (!patch.legalName || patch.legalName.trim().length === 0) {
    throw new Error("createIntake: legalName is required");
  }
  const [row] = await db
    .insert(clientIntakes)
    .values({
      ...columnPatch(patch),
      legalName: patch.legalName,
      monthlyRecurringAmount: moneyOrNull(patch.monthlyRecurringAmount),
      baseMonthlyAmount: moneyOrNull(patch.baseMonthlyAmount),
      perAccountPrice: moneyOrNull(patch.perAccountPrice),
      formData: patch.formData ?? {},
      status: "new",
    })
    .returning();
  if (patch.owners) await replaceIntakeOwners(row.id, patch.owners);
  return row;
}

/**
 * Autosave: patches structured columns and shallow-merges form_data. The
 * first autosave moves new -> in_progress (§6.8). Archived intakes reject
 * edits. Converted (completed) intakes stay editable per §6.8; the caller
 * cascades the same patch to the client.
 */
export async function updateIntake(intakeId: number, patch: IntakePatch): Promise<IntakeRow> {
  const existing = await getIntake(intakeId);
  if (existing.status === "archived") {
    throw new IntakeStatusError("archived", existing.status);
  }

  const columns = columnPatch(patch);
  const set: Partial<IntakeInsert> = { ...columns, updatedAt: new Date() };
  if (existing.status === "new") set.status = "in_progress";
  for (const key of ["monthlyRecurringAmount", "baseMonthlyAmount", "perAccountPrice"] as const) {
    if (key in patch) set[key] = moneyOrNull(patch[key]);
  }
  if (patch.formData) {
    const current = (existing.formData ?? {}) as IntakeFormData;
    set.formData = { ...current, ...patch.formData };
  }

  const [row] = await db
    .update(clientIntakes)
    .set(set)
    .where(eq(clientIntakes.id, intakeId))
    .returning();
  if (patch.owners) await replaceIntakeOwners(intakeId, patch.owners);
  return row;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

/** new/in_progress -> pending_review (the "purgatory" review queue, §6.8). */
export async function submitIntakeForReview(intakeId: number): Promise<IntakeRow> {
  const existing = await getIntake(intakeId);
  assertIntakeTransition(existing.status, "pending_review");
  const [row] = await db
    .update(clientIntakes)
    .set({ status: "pending_review", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(clientIntakes.id, intakeId))
    .returning();
  return row;
}

/** Side exit; a converted intake can never be archived or deleted (§6.8). */
export async function archiveIntake(intakeId: number): Promise<IntakeRow> {
  const existing = await getIntake(intakeId);
  if (existing.clientId != null || existing.status === "completed") {
    throw new IntakeConvertedError(intakeId);
  }
  assertIntakeTransition(existing.status, "archived");
  const [row] = await db
    .update(clientIntakes)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(clientIntakes.id, intakeId))
    .returning();
  return row;
}

export async function deleteIntake(intakeId: number): Promise<void> {
  const existing = await getIntake(intakeId);
  if (existing.clientId != null || existing.status === "completed") {
    throw new IntakeConvertedError(intakeId);
  }
  await db.delete(clientIntakes).where(eq(clientIntakes.id, intakeId));
}

// ── Duplicate detection (§29 fixes) ───────────────────────────────────────

export interface DuplicateCandidate {
  id: number;
  legalName: string;
  dbaName: string | null;
  matchedOn: "tax_id" | "name";
}

/** EIN normalization: digits only; null when nothing usable remains. */
export function normalizeTaxId(taxId: string | null | undefined): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * findDuplicates - §29 fixes by construction:
 *  - exact EIN match after digit-only normalization (the original never
 *    matched on EIN at all);
 *  - case-insensitive, trimmed equality on legal or DBA name;
 *  - deactivated clients (is_active = false) are EXCLUDED (the original
 *    matched them, blocking legitimate re-onboarding);
 *  - NO phone matching of any kind (the original's fuzzy last-seven-digit
 *    "contains" match produced false positives).
 */
export async function findDuplicates(input: {
  legalName?: string | null;
  taxId?: string | null;
}): Promise<DuplicateCandidate[]> {
  const ein = normalizeTaxId(input.taxId);
  const name = input.legalName?.trim().toLowerCase() || null;
  if (!ein && !name) return [];

  const conditions = [];
  if (ein) {
    conditions.push(sql`regexp_replace(${clients.taxId}, '[^0-9]', '', 'g') = ${ein}`);
  }
  if (name) {
    conditions.push(
      or(
        sql`lower(btrim(${clients.legalName})) = ${name}`,
        sql`lower(btrim(${clients.dbaName})) = ${name}`,
      ),
    );
  }

  const rows = await db
    .select({
      id: clients.id,
      legalName: clients.legalName,
      dbaName: clients.dbaName,
      taxId: clients.taxId,
    })
    .from(clients)
    .where(and(eq(clients.isActive, true), or(...conditions)));

  return rows.map((row) => ({
    id: row.id,
    legalName: row.legalName,
    dbaName: row.dbaName,
    matchedOn:
      ein && normalizeTaxId(row.taxId) === ein ? ("tax_id" as const) : ("name" as const),
  }));
}
