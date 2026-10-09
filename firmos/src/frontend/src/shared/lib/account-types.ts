/**
 * The pure account-type tables and proof/statement-day rules (HANDOFF §15,
 * accounts_seed.py port) - extracted from server/accounts-seed.ts so the
 * intake review's estimate breakdowns (J4/V5) apply the SAME billability
 * rules client-side without touching the db layer. server/accounts-seed.ts
 * re-exports everything here; this module must stay dependency-free.
 */

export type RequiredDocumentMode = "statement" | "owner_documented";

export interface AccountTypeDefinition {
  key: string;
  label: string;
  requiredDocument: RequiredDocumentMode;
  /** 31 for statement-requiring types, null for owner-documented (§15). */
  defaultStatementDay: number | null;
}

const statement = (key: string, label: string): AccountTypeDefinition => ({
  key,
  label,
  requiredDocument: "statement",
  defaultStatementDay: 31,
});

const ownerDocumented = (key: string, label: string): AccountTypeDefinition => ({
  key,
  label,
  requiredDocument: "owner_documented",
  defaultStatementDay: null,
});

/**
 * HANDOFF §15 - the sixteen seedable types, in the handoff's own order.
 *
 * AMBIGUITY RESOLVED: the handoff lists the sixteen types and the two modes
 * but never says which type carries which mode. The split below treats the
 * three equity types plus the four related-party loan types (to/from
 * shareholders and to/from others) as owner-documented - no institution
 * issues a statement for those. Institutional liabilities (line of credit,
 * vehicle loan, mortgage, payroll liability, other liability) and asset
 * types keep statements.
 */
export const ACCOUNT_TYPE_DEFINITIONS: readonly AccountTypeDefinition[] = [
  statement("investment", "Investment"),
  ownerDocumented("loans_to_others", "Loans to Others"),
  ownerDocumented("loans_to_shareholders", "Loans to Shareholders"),
  statement("vehicle", "Vehicle"),
  statement("fixed_assets", "Fixed Assets"),
  statement("other_asset", "Other Asset"),
  statement("line_of_credit", "Line of Credit"),
  statement("payroll_liability", "Payroll Liability"),
  statement("vehicle_loan", "Vehicle Loan"),
  ownerDocumented("loans_from_shareholders", "Loans from Shareholders"),
  ownerDocumented("loans_from_others", "Loans from Others"),
  statement("mortgage", "Mortgage"),
  statement("other_liability", "Other Liability"),
  ownerDocumented("owner_contributions", "Owner Contributions"),
  ownerDocumented("owner_distributions", "Owner Distributions"),
  ownerDocumented("other_equity", "Other Equity"),
];

const BY_KEY = new Map(ACCOUNT_TYPE_DEFINITIONS.map((d) => [d.key, d]));

export function accountTypeDefinition(key: string): AccountTypeDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Intake balance-sheet types that are not part of the sixteen seedable keys
 * (§10 step 3: checking, savings, credit, loan, and investment accounts).
 * All are institution-documented, so they default to statement day 31.
 */
const INTAKE_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  "checking",
  "savings",
  "credit_card",
  "merchant",
  "investment",
]);

/**
 * Default statement day for any account type: the type definition wins;
 * intake balance-sheet types get 31; anything unknown gets null (kept out
 * of the queues rather than guessed into them).
 */
export function defaultStatementDayFor(accountType: string): number | null {
  const key = accountType.trim().toLowerCase();
  const definition = BY_KEY.get(key);
  if (definition) return definition.defaultStatementDay;
  return INTAKE_STATEMENT_TYPES.has(key) ? 31 : null;
}

// ── I3 proof categories ───────────────────────────────────────────────────

/**
 * I3 (intake restructure, plan §3): the proof categories an intake account
 * can carry. "statement" accounts enter the recon/statement queues;
 * "owner_declared" and "bill_of_sale" are owner-evidenced and stay out.
 */
export type ProofCategory = "statement" | "owner_declared" | "bill_of_sale";

export const PROOF_CATEGORIES: readonly ProofCategory[] = [
  "statement",
  "owner_declared",
  "bill_of_sale",
];

/** The proof category for an intake account: the captured answer wins;
 *  legacy/extraction rows without one derive it from the type's document
 *  mode (statement-producing -> statement, owner-documented -> owner_declared). */
export function proofCategoryFor(account: {
  accountType: string;
  proofCategory?: string | null;
}): ProofCategory {
  const captured = account.proofCategory?.trim().toLowerCase();
  if (captured === "statement" || captured === "owner_declared" || captured === "bill_of_sale") {
    return captured;
  }
  return defaultStatementDayFor(account.accountType) != null ? "statement" : "owner_declared";
}

/**
 * I3: the statement day for an intake account under the proof-category
 * model - explicit capture (legacy intakes, extraction) wins; statement
 * proof gets the type default (31 for statement-producing types, and for
 * plain "loan" which the seed table leaves untyped); owner-declared and
 * bill-of-sale accounts get no statement day and stay out of the queues.
 */
export function statementDayForIntakeAccount(account: {
  accountType: string;
  statementDay?: number | null;
  proofCategory?: string | null;
}): number | null {
  if (account.statementDay !== undefined) return account.statementDay;
  if (proofCategoryFor(account) !== "statement") return null;
  return defaultStatementDayFor(account.accountType) ?? 31;
}

/**
 * Account types seeded for every converted client (§6.8 "default seeds").
 * The two owner-documented equity accounts every chart of accounts needs;
 * they carry no statement day and stay out of both queues.
 */
export const DEFAULT_SEED_ACCOUNT_TYPES: readonly string[] = [
  "owner_contributions",
  "owner_distributions",
];

// ── L5 (J3, 10_06 01:10:10): the intake-driven equity setup ───────────────
//
// "Is everything just grouped into owner's equity? Are we doing
// contributions, distributions, net investment gain/loss? Are we breaking
// it down by owner?" The intake's equity answers decide what conversion
// seeds; an unanswered intake keeps the §6.8 default pair above.

export interface EquitySeedRow {
  type: string;
  name: string;
}

/** The breakdown picks (values are the stored answer strings). */
export const EQUITY_BREAKDOWN_OPTIONS = [
  { value: "contributions", label: "Contributions" },
  { value: "distributions", label: "Distributions" },
  { value: "net_investment", label: "Net investment gain/loss" },
] as const;

const EQUITY_PICK_SEED: Record<string, { type: string; label: string }> = {
  contributions: { type: "owner_contributions", label: "Owner Contributions" },
  distributions: { type: "owner_distributions", label: "Owner Distributions" },
  net_investment: { type: "other_equity", label: "Net Investment Gain/Loss" },
};

/**
 * The equity accounts conversion seeds for this intake. Returns null when
 * the equity question was never answered (legacy intakes keep the §6.8
 * default pair). A grouped setup seeds one owner's-equity account; a
 * breakdown seeds each picked account; per-owner multiplies the rows by
 * owner ("Owner Contributions - Wren Okafor").
 */
export function equitySeedPlan(form: {
  equitySetup?: string | null;
  equityBreakdown?: string[] | null;
  equityPerOwner?: boolean | null;
  owners?: readonly { name?: string | null }[] | null;
}): EquitySeedRow[] | null {
  if (form.equitySetup !== "grouped" && form.equitySetup !== "breakdown") return null;
  const owners = (form.owners ?? []).map((o) => (o.name ?? "").trim()).filter((n) => n !== "");
  const perOwner = form.equityPerOwner === true && owners.length > 1;
  if (form.equitySetup === "grouped") {
    return perOwner
      ? owners.map((o) => ({ type: "other_equity", name: `Owner's Equity - ${o}` }))
      : [{ type: "other_equity", name: "Owner's Equity" }];
  }
  const picks =
    form.equityBreakdown && form.equityBreakdown.length > 0
      ? form.equityBreakdown
      : ["contributions", "distributions"];
  const chosen = EQUITY_BREAKDOWN_OPTIONS.map((o) => o.value)
    .filter((v) => picks.includes(v))
    .map((v) => EQUITY_PICK_SEED[v]!);
  return perOwner
    ? owners.flatMap((o) => chosen.map((d) => ({ type: d.type, name: `${d.label} - ${o}` })))
    : chosen.map((d) => ({ type: d.type, name: d.label }));
}
