/**
 * The four default recurring rules (HANDOFF §19) seeded at conversion.
 * Canonical list shared by the server (convert.ts seeds them) and the intake
 * wizard. B21 rendered them as a pre-selected checklist writing
 * form_data.excludedDefaultRules (still honored for intakes that never carry
 * a routine schedule); J3 (meeting #3, R1-R2) replaces that checklist with
 * the "Routine order and frequency" scheduler screen, which derives these
 * four as cards in the client's cadence bucket - default order categorize ->
 * reconcile -> client questions -> send reports (00:39:26-00:40:23).
 */
export interface DefaultRuleDefinition {
  key: string;
  title: string;
  /** Which seat the rule belongs to (manager | bookkeeper). */
  assignee: "manager" | "bookkeeper";
  /** Close-work rules land on the close tier day; client-touch rules on the 25th. */
  dueDay: "tier" | 25;
  /** Checklist help text in the intake wizard. */
  help: string;
}

export const DEFAULT_RECURRING_RULES: readonly DefaultRuleDefinition[] = [
  {
    key: "reconcile_accounts",
    title: "Reconcile Accounts",
    assignee: "bookkeeper",
    dueDay: "tier",
    help: "Every account reconciled to its statement",
  },
  {
    key: "categorize_transactions",
    title: "Categorize Transactions",
    assignee: "bookkeeper",
    dueDay: "tier",
    help: "Bank feeds categorized through the close",
  },
  {
    key: "client_questions",
    title: "Client Questions",
    assignee: "manager",
    dueDay: 25,
    help: "Open questions gathered and sent to the client",
  },
  {
    key: "send_reports",
    title: "Send Reports",
    assignee: "manager",
    dueDay: "tier",
    help: "Monthly package delivered by the close tier",
  },
] as const;

export const DEFAULT_RULE_KEYS: readonly string[] = DEFAULT_RECURRING_RULES.map((r) => r.key);

/**
 * Answer-derived recurring seeds (B18/A41/I6) - the titles live here (not in
 * convert.ts) because the J3 routine scheduler renders the same cards in the
 * intake wizard, and the registry is client-side (convert.ts imports the db).
 * J2 (R6): the preliminary-reports note stamped on the Send Reports rule.
 */
export const PERSONAL_CARD_REMINDER_TITLE = "Ask client for personal-card business-expense breakdown";
export const NON_BUSINESS_DEPOSITS_REVIEW_TITLE = "Review non-business deposits - record as owner contribution";
// K1 (E5, 09_30 00:54:51): the task matches the card's wording - "these
// non-business related reminder things should just match what we have on
// the previous card" (was "Confirm owner draws with the client").
export const OWNER_DRAWS_CONFIRMATION_TITLE = "Review non-business expenses on business accounts with the client";
export const MERCHANT_RECONCILIATION_TITLE = "Merchant reconciliation";
// K5 (C10, 09_30 00:34:07): the deposits mirror of the bills flow.
export const RECORD_DEPOSITS_TITLE = "Record deposits";
// K5 (E9, 09_30 00:59:13): every bookkeeping client gets the annual tax
// readiness checklist ("we verify everything to make sure everything's
// ready for your taxes").
export const EOY_TAX_CHECKLIST_TITLE = "Year-end tax readiness checklist";
export const EOY_TAX_CHECKLIST_ITEMS: readonly string[] = [
  "Verify every account is reconciled through year-end",
  "Review intercompany loans",
  "Confirm all data is entered",
  "Confirm owner draws / non-business spend reviewed with the client",
  "Package the books ready for the tax preparer",
];
export const PRELIMINARY_REPORTS_NOTE =
  "Send the package even when client questions are still open, marked preliminary (intake choice).";
