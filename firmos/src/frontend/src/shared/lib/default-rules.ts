/**
 * The four default recurring rules (HANDOFF §19) seeded at conversion.
 * Canonical list shared by the server (convert.ts seeds them) and the intake
 * wizard (registry.ts renders them as the pre-selected checklist, B21) -
 * the wizard unselects by `key`, and form_data carries the excluded keys.
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
