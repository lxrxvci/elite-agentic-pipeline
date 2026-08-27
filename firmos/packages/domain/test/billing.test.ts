import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEBRUARY_BILLED_SERVICE_KEYS,
  isFebruaryBilledService,
  februaryBilledDue,
  LOAN_ACCOUNT_TYPES,
  isReconciliationBillableAccount,
  renormalizeTemplateQuantity,
} from "../src/billing.ts";

// ---- February-billed 1099 services (HANDOFF §6.5/§15) -------------------------
test("FEBRUARY_BILLED_SERVICE_KEYS covers the three 1099 services", () => {
  assert.deepEqual([...FEBRUARY_BILLED_SERVICE_KEYS].sort(), [
    "1099_collection",
    "1099_full_management",
    "1099_per_filing",
  ]);
  assert.equal(isFebruaryBilledService("1099_per_filing"), true);
  assert.equal(isFebruaryBilledService("account_reconciliations"), false);
});
test("billed only in February of years AFTER the billing anchor year", () => {
  // anchor 2025 → first February billed is 2026 (the first partial year is not charged)
  assert.equal(februaryBilledDue("1099_collection", { year: 2026, month: 2 }, 2025), true);
  assert.equal(februaryBilledDue("1099_collection", { year: 2025, month: 2 }, 2025), false);
  assert.equal(februaryBilledDue("1099_collection", { year: 2026, month: 1 }, 2025), false);
  assert.equal(februaryBilledDue("1099_collection", { year: 2026, month: 3 }, 2025), false);
  assert.equal(februaryBilledDue("account_reconciliations", { year: 2026, month: 2 }, 2025), false);
  assert.equal(februaryBilledDue("1099_per_filing", { year: 2030, month: 2 }, 2025), true);
});

// ---- intake_cycle → billing_cycle renormalization (HANDOFF §6.5, §30 conv. 9) --
test("monthly template items are renormalized quantity / intake_cycle × billing_cycle", () => {
  // priced at a quarterly intake cadence, billed monthly
  assert.equal(renormalizeTemplateQuantity(3, 3, 1), 1);
  // priced monthly, billed quarterly (one invoice covers three months of work)
  assert.equal(renormalizeTemplateQuantity(1, 1, 3), 3);
  // annual intake, quarterly billing
  assert.equal(renormalizeTemplateQuantity(12, 12, 3), 3);
  // same cadence → unchanged
  assert.equal(renormalizeTemplateQuantity(5, 3, 3), 5);
});

// ---- Per-account exclusion (HANDOFF §6.5/§15) -----------------------------------
test("LOAN_ACCOUNT_TYPES covers lines of credit, vehicle loans, shareholder loans, loans to/from others, mortgages", () => {
  for (const t of [
    "line_of_credit",
    "vehicle_loan",
    "loans_to_shareholders",
    "loans_from_shareholders",
    "loans_to_others",
    "loans_from_others",
    "mortgage",
  ]) {
    assert.ok(LOAN_ACCOUNT_TYPES.has(t), t);
  }
});
test("the per-account reconciliation count is live: active + statement day, no loans, no merchants", () => {
  assert.equal(
    isReconciliationBillableAccount({ account_type: "checking", is_active: true, statement_day: 31 }),
    true,
  );
  assert.equal(
    isReconciliationBillableAccount({ account_type: "mortgage", is_active: true, statement_day: 31 }),
    false, // loans bill under their own service - charging the recon rate double-bills
  );
  assert.equal(
    isReconciliationBillableAccount({ account_type: "line_of_credit", is_active: true, statement_day: 15 }),
    false,
  );
  assert.equal(
    isReconciliationBillableAccount({ account_type: "merchant_account", is_active: true, statement_day: 31 }),
    false, // merchant accounts bill under their own service
  );
  assert.equal(
    isReconciliationBillableAccount({ account_type: "checking", is_active: true, statement_day: null }),
    false, // no statement day → not in the reconciliation queue
  );
  assert.equal(
    isReconciliationBillableAccount({ account_type: "checking", is_active: false, statement_day: 31 }),
    false,
  );
});
