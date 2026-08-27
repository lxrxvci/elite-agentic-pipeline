import { db } from "@/db";
import { accounts } from "@/db/schema";

/**
 * ACCOUNT_TYPE_DEFINITIONS - HANDOFF §15 (accounts_seed.py port).
 *
 * The sixteen seedable account types, each with a required-document mode:
 *  - "statement": a third-party statement exists, so the type defaults to
 *    statement_day 31 and enters the reconciliation and statement queues.
 *  - "owner_documented": no third-party statement exists (equity movements
 *    and related-party loans are documented by the owner), so the type gets
 *    no statement day and is excluded from both queues.
 *
 * AMBIGUITY RESOLVED: the handoff lists the sixteen types and the two modes
 * but never says which type carries which mode. The split below treats the
 * three equity types plus the four related-party loan types (to/from
 * shareholders and to/from others) as owner-documented - no institution
 * issues a statement for those. Institutional liabilities (line of credit,
 * vehicle loan, mortgage, payroll liability, other liability) and asset
 * types keep statements.
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

/** HANDOFF §15 - the sixteen seedable types, in the handoff's own order. */
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

/**
 * Account types seeded for every converted client (§6.8 "default seeds").
 * The two owner-documented equity accounts every chart of accounts needs;
 * they carry no statement day and stay out of both queues.
 */
export const DEFAULT_SEED_ACCOUNT_TYPES: readonly string[] = [
  "owner_contributions",
  "owner_distributions",
];

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
      const definition = BY_KEY.get(key);
      if (!definition) throw new Error(`seedDefaultAccounts: unknown account type: ${key}`);
      return {
        clientId,
        name: definition.label,
        accountType: definition.key,
        statementDay: definition.defaultStatementDay,
        openDate: opts.openDate ?? null,
      };
    });
  if (values.length === 0) return [];
  return dbOrTx.insert(accounts).values(values).returning();
}
