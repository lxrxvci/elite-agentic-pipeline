import { and, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientIntakes, clients, intakeOwners } from "@/db/schema";
import type { RoutineSchedule } from "@/shared/lib/routine-schedule";

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
  /**
   * I1 (00:27:59): owners carry a phone and a receives-reports flag. Both
   * live on form_data only - intake_owners has no columns for them (I6 grew
   * contact_client_links.receives_reports instead; conversion and the cascade
   * read the form_data copy by owner name).
   */
  phone?: string | null;
  receivesReports?: boolean;
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
  /** J1 (C4/C5): set when the contact was picked from the type-ahead lookup
   *  of existing contacts - conversion LINKS that row with the new role
   *  instead of creating a duplicate person. */
  contactId?: number | null;
}

/**
 * I3 (intake restructure, plan §3): how the account's balances are
 * evidenced. Checking/savings/credit-card accounts are locked to
 * "statement" at intake; loans, vehicles, and other assets pick a category.
 * Conversion stamps it onto accounts.proof_category and derives the
 * statement day from it (statement -> month-end default; the other two ->
 * no statement day, out of the recon/statement queues).
 */
export type IntakeProofCategory = "statement" | "owner_declared" | "bill_of_sale";

export interface IntakeAccountInput {
  name: string;
  accountType: string;
  institution?: string | null;
  /** I3: canonical link into the institutions table (dropdown pick or
   *  inline add-new); the institution text above stays as the snapshot. */
  institutionId?: number | null;
  /** I3: proof category; absent on legacy/extraction rows, where conversion
   *  derives it from the account type (statement-mode -> statement). */
  proofCategory?: IntakeProofCategory;
  /** Explicit override; null/undefined falls back to the type default (§15).
   *  I3: no longer captured in intake - conversion-time concern. */
  statementDay?: number | null;
  openDate?: string | null;
  requiresManualTransactions?: boolean;
  /**
   * 3B (01:18:40): the intake's "grant us login access" per-account flag.
   * Conversion opens an expected-credential vault slot for each flagged
   * account; the client fills it in the portal. I3: set from the money
   * mini-forms or the online-access checklist screen.
   */
  grantLoginAccess?: boolean;
  /** I3 loans: the lender (free text) and an optional current balance.
   *  J1 (D3/D6): balance is no longer captured (researched later); the
   *  lender is an institution dropdown pick when proof = statement
   *  (lenderInstitutionId carries the FK, lender keeps the name snapshot)
   *  and a free-text write-in when proof = owner_declared - write-ins NEVER
   *  enter the institutions table. */
  lender?: string | null;
  lenderInstitutionId?: number | null;
  balance?: number | null;
  /** J1 (D1): the masked last-4 capture on money accounts - exactly 4
   *  digits, enforced by the mini-form and again at conversion. With the
   *  nickname field gone, bank + type + last4 IS the account's name
   *  (derived via shared/lib/account-label). */
  last4?: string | null;
  /** J1 (D5) vehicles: "financed" auto-routes a linked loan entry into the
   *  loans screen ("<description> (vehicle loan)"); "paid" stays an asset
   *  only. Required on the vehicles card. */
  financed?: "financed" | "paid" | null;
  /** J1 (D5): marks an auto-created vehicle-loan entry on the loans card;
   *  the value is the financed vehicle's description, so re-committing the
   *  vehicles card reconciles (create missing, drop orphaned, keep edits). */
  fromVehicle?: string | null;
  /** I3 vehicles: model year and an optional value estimate.
   *  J1 (D3): the value estimate is no longer asked in intake; the field
   *  stays for legacy/extraction rows. */
  year?: number | null;
  value?: number | null;
  /** I3 other assets: the typed bucket (equipment / furniture / goodwill /
   *  investments / other) - also drives the account_type mapping. */
  assetType?: string | null;
}

/** §29 fix: merchant accounts keep every field and never collapse to one.
 *  J1 (E4/DB1): the processor picks from the merchant_processors table
 *  (processorId carries the FK; processor keeps the name snapshot). */
export interface IntakeMerchantAccountInput {
  name: string;
  processor?: string | null;
  processorId?: number | null;
}

/**
 * One report the firm tracks for the client (§6.3), now first-class
 * specialty-report definitions (C10): name + the report's OWN frequency
 * (independent of the client's close frequency), a data-source/portal note,
 * and pricing - estimated hours (priced hours x rate by the quote engine) or
 * a flat per-report price. missedFilings counts unfiled past reports; each
 * prices one-time at the per-report price in the catch-up quote.
 */
export interface IntakeReportDefinition {
  name: string;
  frequency: string;
  /** Where the data comes from (portal, QBO, the client's bookkeeper, ...). */
  dataSource?: string | null;
  estimatedHours?: number | null;
  /** Flat price per report; wins over estimatedHours x rate when present. */
  flatPrice?: number | null;
  /** Hourly rate override; the quote engine's default rate applies otherwise. */
  hourlyRate?: number | null;
  /**
   * J2 (meeting #3): the wizard captures a yes/no - true means past filings
   * were missed and lastFiledDate carries the most recent filing; the quote
   * derives the missed COUNT from that date x the cadence through today
   * (server/quote.ts). Legacy/extraction rows may still carry a raw count
   * (number) - honored verbatim. Either way each missed filing prices
   * one-time at the per-report price.
   */
  missedFilings?: number | boolean | null;
  /** ISO YYYY-MM-DD of the most recent filing (required when missedFilings is true). */
  lastFiledDate?: string | null;
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
  /** J3 (R4): every-N-weeks interval for weekly rules (null/1 = every week). */
  weekInterval?: number | null;
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

/** A mid-intake tangent captured from the wizard's running-notes rail. */
export interface IntakeRunningNote {
  text: string;
  /** ISO timestamp from the wizard client at capture time. */
  at: string;
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
  /** Per-service discount capture (C1): flat dollars off per billing cycle,
   *  keyed by service key; the quote engine clamps each line at zero.
   *  Legacy - J4 (V4) presents direct price editing instead; stored
   *  discounts on old intakes keep pricing exactly as before. */
  serviceDiscounts?: Record<string, number>;
  /** J4 (V4, meeting #3 01:01:22-01:02:14): direct per-line price overrides
   *  (flat dollars per billing cycle), keyed by service key. An override
   *  replaces the line's standard amount outright and wins over any legacy
   *  discount on the same line; it can even price an unpriced line. */
  servicePrices?: Record<string, number>;
  customItems?: IntakeCustomItemInput[];
  owners?: IntakeOwnerInput[];
  contacts?: IntakeContactInput[];
  referralSource?: string | null;
  /** I1: who to thank, when the referral source is a client or CPA.
   *  J1 (C7): the answer is picker-driven - referralContactId/referralClientId
   *  carry the link when an existing contact/client was picked, so referral
   *  bonuses stay attributable over time; referralWho keeps the name. */
  referralWho?: string | null;
  referralContactId?: number | null;
  referralClientId?: number | null;
  /** I2 (00:15:53): the LLC tax classification follow-up - llc_sml /
   *  llc_partnership / llc_scorp / llc_ccorp. Form-data only (the
   *  tax_structure column keeps the stable top-level value). */
  llcSubclass?: string | null;
  /** I1: the dedicated CPA card (00:30:14) - "Do they have a CPA who files
   *  their taxes?" plus the CPA's name/email when yes.
   *  J1 (C6): the card is picker-first - cpaContactId is set when an
   *  existing contact was picked (conversion links it; never a duplicate). */
  hasCpa?: boolean;
  cpaName?: string | null;
  cpaEmail?: string | null;
  cpaContactId?: number | null;
  /** I1 (00:15:53): verbatim custom text behind a select's "Other - type
   *  it" card, keyed by registry question id. The answer key itself keeps
   *  the canonical 'Other' value; conversion treats this as pass-through
   *  record data and never maps it onto enum columns. */
  customAnswers?: Record<string, string>;
  // Step 2 - starting point
  isExistingClient?: boolean;
  /** I1 (00:31:05): 'consulting' runs on the project-engagement track. */
  engagementType?: "bookkeeping" | "project" | "consulting";
  quickbooksStatus?: string | null;
  needsQuickbooksSetup?: boolean;
  /** Seats needed in QuickBooks; drives the tier recommendation (§15 QBO pass-through). */
  qboUserCount?: number | null;
  /** Explicit plan pick; null/absent means the quote recommends from the matrix. */
  qboSubscriptionTier?: "simple_start" | "essentials" | "plus" | "advanced" | null;
  bookkeepingStartDate?: string | null;
  bankFeedCatchupDate?: string | null;
  /** A45 (00:34:18): "When was the business established?" - form_data only
   *  (clients carry no established-date column); informs nothing downstream. */
  businessEstablishedDate?: string | null;
  // Step 3 - balance sheet
  /**
   * I3: the canonical flattened account list, written by buildPatch from
   * the six per-type arrays below (and still the shape call-notes
   * extraction writes). Conversion, the quote, and cascade read this.
   */
  accounts?: IntakeAccountInput[];
  /** I3 (plan §1 screen 7): the sequential per-type count cards. Each
   *  array holds that type's mini-form entries; buildPatch flattens them
   *  into `accounts` in screen order. Legacy intakes carry only `accounts`
   *  - answersFromIntake splits those back into the per-type arrays. */
  checkingAccounts?: IntakeAccountInput[];
  savingsAccounts?: IntakeAccountInput[];
  creditCardAccounts?: IntakeAccountInput[];
  loanAccounts?: IntakeAccountInput[];
  vehicleAssets?: IntakeAccountInput[];
  otherAssets?: IntakeAccountInput[];
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
  /** B18: "personal credit card used for business" - yes/sometimes both land
   *  here as true; conversion seeds the monthly breakdown reminder task. */
  personalCardForBusiness?: boolean;
  /** A41 (00:48:07): "deposit anything that isn't business income?" - true
   *  seeds the monthly owner-contribution review task at conversion. */
  depositsNonBusiness?: boolean;
  /** A41 (00:48:07): "pay for non-business things on business accounts?" -
   *  true seeds the monthly owner-draws confirmation task at conversion. */
  personalOnBusiness?: boolean;
  /** J2 (meeting #3, E1-E3): the mandatory explanation note captured from the
   *  blocking overlay when a money-behavior card is answered yes, keyed by
   *  the registry question id (deposits-non-business / personal-on-business /
   *  personal-card). Conversion carries the note into the seeded task's
   *  description. */
  behaviorNotes?: Record<string, string>;
  // Step 5 - reporting and payroll
  bookkeepingFrequency?: string | null;
  billingFrequency?: string | null;
  monthlyCloseTier?: string | null;
  accountingMethod?: string | null;
  payrollProvider?: string | null;
  /** J2 (meeting #3, P1): the payroll-services "they process their own
   *  payroll" pick - we just download and enter the reports. Not a service
   *  key (nothing to bill); conversion notes it on the client record. */
  payrollSelfProcessed?: boolean;
  reportDefinitions?: IntakeReportDefinition[];
  estimated1099Count?: number | null;
  include1099Collection?: boolean;
  include1099FullManagement?: boolean;
  includeMerchantReconciliation?: boolean;
  /** J2 (meeting #3, E6): bills split into record + pay. recordBills drives
   *  the record_bills service key (legacy intakes may carry the old
   *  includeBillPay flag - still honored as the fallback); payBills requires
   *  recordBills and carries the places bills get paid. */
  recordBills?: boolean;
  payBills?: boolean;
  billPayLocations?: string[];
  /** J2 (meeting #3, R6): send reports before the client's open questions
   *  are answered; conversion notes it on the seeded Send Reports rule. */
  sendPreliminaryReports?: boolean;
  qboClassNames?: string[];
  qboLocationNames?: string[];
  // Step 6 - recurring and notes
  customRecurringRules?: IntakeCustomRuleInput[];
  internalNotes?: string | null;
  /** B21: keys of the §19 default recurring rules the user UNSELECTED in the
   *  intake checklist (all four are pre-selected; absent = all selected).
   *  Legacy pre-J3 intakes only - the J3 scheduler screen supersedes this. */
  excludedDefaultRules?: string[];
  /** J3 (meeting #3, R1-R5): the "Routine order and frequency" schedule map,
   *  keyed by task key (the standard four, answer-derived add-ons, specialty
   *  reports, custom rules). Present once the final intake screen commits;
   *  absent = the intake never touched the scheduler and converts exactly as
   *  pre-J3. */
  routineSchedule?: RoutineSchedule;
  /** Running-notes rail entries; ride form_data so autosave preserves them. */
  runningNotes?: IntakeRunningNote[];
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
  // I1/I6: phone/receivesReports stay on form_data.owners - intake_owners has
  // no columns for them; the link column (receives_reports) is stamped from
  // this copy at conversion/merge.
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
