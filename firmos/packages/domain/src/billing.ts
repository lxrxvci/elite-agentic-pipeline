/**
 * @firmos/domain - billing rules (HANDOFF §6.5, §15; billing_rules.py and
 * client_billing_sync.py in the Python original).
 *
 * The price flows in one direction: intake answers → calculate_quote() →
 * recurring services template → invoice line items. This module owns the
 * invoice-side rules: cadence renormalization, February-billed 1099s, and
 * the per-account exclusion.
 */

import type { Month } from "./dates.ts";

/**
 * HANDOFF §6.5: 1099 services bill in February of the following year, so a
 * client's first partial year is not charged.
 */
export const FEBRUARY_BILLED_SERVICE_KEYS: ReadonlySet<string> = new Set([
  "1099_collection",
  "1099_full_management",
  "1099_per_filing",
]);

export function isFebruaryBilledService(serviceKey: string): boolean {
  return FEBRUARY_BILLED_SERVICE_KEYS.has(serviceKey);
}

/**
 * HANDOFF §6.5: a February-billed service appears on an invoice only when
 * the invoice month is February AND the invoice year is later than the
 * client's billing anchor year.
 */
export function februaryBilledDue(
  serviceKey: string,
  invoiceMonth: Month,
  billingAnchorYear: number,
): boolean {
  return (
    isFebruaryBilledService(serviceKey) &&
    invoiceMonth.month === 2 &&
    invoiceMonth.year > billingAnchorYear
  );
}

/**
 * HANDOFF §6.5/§30 convention 9: the template's quantities were scaled for
 * the bookkeeping cadence (intake_cycle), and each invoice covers
 * billing_cycle months - monthly template items are renormalized as
 * quantity / intake_cycle × billing_cycle. A quarterly-billed client gets
 * one invoice covering three months of work. Getting this wrong under-bills
 * silently.
 */
export function renormalizeTemplateQuantity(
  quantity: number,
  intakeCycle: number,
  billingCycle: number,
): number {
  return (quantity / intakeCycle) * billingCycle;
}

/**
 * HANDOFF §6.5: LOAN_ACCOUNT_TYPES covers lines of credit, vehicle loans,
 * shareholder loans, loans to and from others, and mortgages. Loans and
 * merchant accounts bill under their own services, so the per-account
 * reconciliation count excludes both - charging those the reconciliation
 * rate as well double-bills the same account.
 */
export const LOAN_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  "line_of_credit",
  "vehicle_loan",
  "loans_to_shareholders",
  "loans_from_shareholders",
  "loans_to_others",
  "loans_from_others",
  "mortgage",
]);

/** Duck-typed account for the live per-account count (HANDOFF §15:
 *  "active accounts that have a statement day, excluding merchant and loan
 *  types"). */
export interface BillableAccount {
  account_type?: string | null;
  is_active?: boolean | null;
  statement_day?: number | null;
}

/** True when an account counts toward the per-account reconciliation line. */
export function isReconciliationBillableAccount(account: BillableAccount): boolean {
  if (account.is_active === false) return false;
  if (!account.statement_day) return false;
  const type = (account.account_type ?? "").toLowerCase();
  if (LOAN_ACCOUNT_TYPES.has(type)) return false;
  if (type.includes("merchant")) return false;
  return true;
}
