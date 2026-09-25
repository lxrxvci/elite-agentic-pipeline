import {
  calculateQuote,
  isReconciliationBillableAccount,
  PRICING,
  type CustomItemInput,
  type LocalDate,
  type PricingOverrides,
  type Quote,
  type QuoteInput,
  type QuoteServiceInput,
  type SpecialtyReportInput,
} from "@firmos/domain";

import { statementDayForIntakeAccount } from "./accounts-seed";
import { localToday } from "./dates";
import type { IntakeCustomItemInput, IntakeFormData } from "./intake";
import { getPricingOverrides } from "./pricing-config";

/**
 * Intake quote mapping (HANDOFF §6.5/§15, routes_quotes.py).
 *
 * Server-only: the intake wizard posts its answers here (debounced) and
 * renders the result; no price is ever computed in the UI. All pricing math
 * lives in @firmos/domain - this module only translates the wizard payload
 * into the domain's QuoteInput and shapes the result for storage.
 */

export interface IntakeQuoteAnswers extends IntakeFormData {
  /** Structured-column fallbacks when the wizard payload omits them. */
  bookkeepingFrequency?: string | null;
  accountingMethod?: string | null;
  monthlyCloseTier?: string | null;
}

/**
 * Service quantity resolution. Per-unit services default their count from
 * the wizard's live data; an explicit serviceQuantities entry always wins.
 *  - account_reconciliations: reconciliation-billable accounts only (§6.5:
 *    merchant and loan account types are excluded via the domain predicate,
 *    so the same account is never double-billed).
 *  - class_tracking / location_tracking: QBO class/location name counts.
 *  - 1099_per_filing: the estimated filing count.
 */
function defaultQuantityFor(key: string, answers: IntakeQuoteAnswers): number | undefined {
  switch (key) {
    case "account_reconciliations": {
      const accounts = answers.accounts ?? [];
      const merchants = (answers.merchantAccounts ?? []).map((m) => ({
        account_type: "merchant",
        statement_day: 31,
      }));
      const all = [
        // I3: the proof category drives the statement day (statement-proof
        // accounts reconcile monthly; owner-declared/bill-of-sale don't).
        ...accounts.map((a) => ({
          account_type: a.accountType,
          statement_day: statementDayForIntakeAccount(a),
        })),
        ...merchants,
      ];
      return all.filter((a) => isReconciliationBillableAccount(a)).length;
    }
    case "class_tracking":
      return answers.qboClassNames?.length;
    case "location_tracking":
      return answers.qboLocationNames?.length;
    case "1099_per_filing":
      return answers.estimated1099Count ?? undefined;
    default:
      return undefined;
  }
}

/**
 * C10: specialty report definitions price into the quote at their own
 * cadence. Only definitions carrying pricing data (hours, a flat price, or a
 * missed-filings count) reach the engine; pure tracking definitions stay out
 * of the money (they still materialize report rows at conversion). The quote
 * line keys (specialty_report_{n}) index into THIS filtered array, so every
 * caller of buildRecurringServicesTemplate must pass the same list.
 */
export function specialtyReportsFromIntake(
  answers: Pick<IntakeQuoteAnswers, "reportDefinitions">,
): SpecialtyReportInput[] {
  return (answers.reportDefinitions ?? [])
    .filter((r) => r.estimatedHours != null || r.flatPrice != null || (r.missedFilings ?? 0) > 0)
    .map((r) => ({
      name: r.name,
      frequency: r.frequency,
      estimatedHours: r.estimatedHours ?? null,
      flatPrice: r.flatPrice ?? null,
      hourlyRate: r.hourlyRate ?? null,
      missedFilings: r.missedFilings ?? null,
    }));
}

function toQuoteInput(answers: IntakeQuoteAnswers, today: LocalDate): QuoteInput {
  const serviceKeys = answers.serviceKeys ?? [];
  const services: QuoteServiceInput[] = serviceKeys.map((key) => {
    if (!PRICING[key]) throw new Error(`unknown service key: ${key}`);
    const explicit = answers.serviceQuantities?.[key];
    // C1 follow-through: the wizard's per-service discount (flat dollars off
    // per billing cycle) rides the service input; the domain clamps at zero.
    const discount = answers.serviceDiscounts?.[key];
    return {
      key,
      quantity: explicit ?? defaultQuantityFor(key, answers),
      discount: discount != null && Number.isFinite(discount) && discount > 0 ? discount : undefined,
    };
  });

  const customItems: CustomItemInput[] = (answers.customItems ?? []).map((item, i) => ({
    key: `custom_item_${i + 1}`,
    product_name: item.productName,
    unit_price: item.unitPrice,
    frequency: item.frequency,
    quantity: item.quantity,
  }));

  // C10 specialty reports: see specialtyReportsFromIntake (only priced
  // definitions reach the engine).
  const specialtyReports = specialtyReportsFromIntake(answers);

  // QBO pass-through (owner walkthrough): every QuickBooks status ends on
  // QBO, so any answered status prices the tier line - recommended from the
  // seat count + tracking complexity unless a plan was picked explicitly.
  // I1: the one exception is the wizard's canonical custom-answer sentinel
  // 'Other' (typed text rides form_data.customAnswers) - not QuickBooks, no
  // QBO line. Legacy aliases like "has_qbo" still price, as before.
  const qbo = answers.quickbooksStatus && answers.quickbooksStatus !== "Other"
    ? {
        userCount: answers.qboUserCount ?? null,
        classTracking: serviceKeys.includes("class_tracking"),
        locationTracking: serviceKeys.includes("location_tracking"),
        explicitTier: answers.qboSubscriptionTier ?? null,
      }
    : null;

  // Retroactive scope: the bookkeeping start date plus the current month
  // (threaded in, never a clock read here) price the cleanup month by month.
  const retroactive =
    serviceKeys.includes("retroactive_bookkeeping") && answers.bookkeepingStartDate
      ? {
          startDate: answers.bookkeepingStartDate,
          currentMonth: { year: today.year, month: today.month },
        }
      : null;

  return {
    reportFrequency: answers.bookkeepingFrequency ?? null,
    // I1: a custom "Other" payroll-frequency answer must never reach the
    // domain's exhaustive switch (payrollPeriodsPerMonth would NaN the quote).
    payrollFrequency: ["weekly", "biweekly", "semi_monthly", "monthly"].includes(
      String(answers.payrollFrequency),
    )
      ? (answers.payrollFrequency as QuoteInput["payrollFrequency"] & string)
      : "monthly",
    services,
    customItems,
    qbo,
    retroactive,
    specialtyReports,
  };
}

/**
 * Wizard answers -> the full domain quote (line items + effective monthly).
 * `today` sets the retroactive month count; it defaults to the firm-local
 * today and is threaded explicitly by conversion (§30 convention 4).
 * `pricingOverrides` is merged over the domain PRICING table before any math
 * (admin-configurable pricing); with none the quote is byte-identical to the
 * default table.
 */
export function calculateIntakeQuote(
  answers: IntakeQuoteAnswers,
  today: LocalDate = localToday(),
  pricingOverrides?: PricingOverrides | null,
): Quote {
  return calculateQuote(toQuoteInput(answers, today), pricingOverrides);
}

/**
 * The config-aware variant every async caller uses: reads the admin pricing
 * overrides from app_settings and prices against the merged table, so the
 * wizard panel, conversion, cascade, and billing resync all follow admin
 * pricing changes without a code deploy.
 */
export async function calculateIntakeQuoteWithConfig(
  answers: IntakeQuoteAnswers,
  today: LocalDate = localToday(),
): Promise<Quote> {
  return calculateIntakeQuote(answers, today, await getPricingOverrides());
}

// ── Recurring services template (§6.5 price flow, step 2) ────────────────

/**
 * One JSON line on client.recurring_services_template (§15 shape:
 * service_key, product_name, unit_price, quantity, discount, frequency,
 * notes; manual_edit marks hand-edited lines merged back on every rebuild).
 */
export interface TemplateLineItem {
  service_key: string;
  product_name: string;
  unit_price: number | null;
  quantity: number;
  discount: number;
  frequency: string;
  notes: string | null;
  manual_edit?: boolean;
  [key: string]: unknown;
}

const BUCKET_FREQUENCY: Record<string, string> = {
  one_time: "one_time",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
  payroll_monthly: "monthly",
};

/**
 * Quote -> the recurring services template stored on the client. Custom
 * items keep their own frequency (§15 quantity scaling is per item
 * frequency); everything else follows its pricing bucket. Per-line discounts
 * carry verbatim so the invoice engine bills the discounted rate.
 *
 * Specialty report lines (C10, keys specialty_report_{n}[_retro]): the quote
 * line's quantity is already cycle-normalized (occurrences per intake cycle),
 * which is exactly the quantity semantics the invoice engine's periodic
 * spread expects; the template line just needs the report's OWN frequency so
 * the spread bills it correctly on any billing cadence. Retro missed-filings
 * lines store as one_time (the engine never recurs them; they exist so the
 * client sees the full catch-up price on the template).
 */
export function buildRecurringServicesTemplate(
  quote: Quote,
  customItems: IntakeCustomItemInput[] = [],
  specialtyReports: SpecialtyReportInput[] = [],
): TemplateLineItem[] {
  return quote.lines.map((line) => {
    const customMatch = line.service_key.startsWith("custom_item_")
      ? customItems[Number(line.service_key.replace("custom_item_", "")) - 1]
      : undefined;
    const specialtyMatch = line.service_key.match(/^specialty_report_(\d+)(_retro)?$/);
    if (specialtyMatch) {
      const report = specialtyReports[Number(specialtyMatch[1]) - 1];
      const isRetro = specialtyMatch[2] != null;
      return {
        service_key: line.service_key,
        product_name: line.product_name,
        unit_price: line.unit_price,
        quantity: line.quantity,
        discount: line.discount ?? 0,
        frequency: isRetro ? "one_time" : (report?.frequency ?? "monthly"),
        notes: line.unpriced ? "Priced manually: no amount stated in HANDOFF §15." : null,
      };
    }
    return {
      service_key: line.service_key,
      product_name: line.product_name,
      unit_price: line.unit_price,
      quantity: line.quantity,
      discount: line.discount ?? 0,
      frequency: customMatch?.frequency ?? BUCKET_FREQUENCY[line.bucket] ?? "monthly",
      notes: line.unpriced ? "Priced manually: no amount stated in HANDOFF §15." : null,
    };
  });
}

export interface QuoteAmountStamps {
  monthlyRecurringAmount: string;
  baseMonthlyAmount: string | null;
  perAccountPrice: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The three amount columns stamped on the client at conversion/resync:
 *  - monthly_recurring_amount: the quote's effective monthly figure.
 *  - base_monthly_amount: the monthly-bucket total normalized to one month.
 *  - per_account_price: the reconciliation unit price when the engagement
 *    bills per account, else null.
 */
export function quoteAmountStamps(quote: Quote): QuoteAmountStamps {
  const reconLine = quote.lines.find((l) => l.service_key === "account_reconciliations");
  return {
    monthlyRecurringAmount: round2(quote.totals.effectiveMonthly).toFixed(2),
    baseMonthlyAmount: round2(quote.totals.totalMonthly / quote.billingCycle).toFixed(2),
    perAccountPrice: reconLine?.unit_price != null ? reconLine.unit_price.toFixed(2) : null,
  };
}

/**
 * Rebuild a template from a fresh quote while preserving manual edits
 * (§6.5): a manual line wins outright for its key, and manual extras
 * (keys the rebuild no longer produces) are appended.
 */
export function mergeManualTemplateLines(
  rebuilt: TemplateLineItem[],
  existing: unknown,
): TemplateLineItem[] {
  const existingLines = Array.isArray(existing) ? (existing as TemplateLineItem[]) : [];
  const manual = existingLines.filter((l) => l && l.manual_edit === true);
  if (manual.length === 0) return rebuilt;

  const manualByKey = new Map(manual.map((l) => [l.service_key, l]));
  const merged = rebuilt.map((line) => manualByKey.get(line.service_key) ?? line);
  const rebuiltKeys = new Set(rebuilt.map((l) => l.service_key));
  for (const line of manual) {
    if (!rebuiltKeys.has(line.service_key)) merged.push(line);
  }
  return merged;
}
