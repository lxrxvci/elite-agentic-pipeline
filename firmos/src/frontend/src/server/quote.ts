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
} from "@firmos/domain";

import { defaultStatementDayFor } from "./accounts-seed";
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
        ...accounts.map((a) => ({
          account_type: a.accountType,
          statement_day: a.statementDay ?? defaultStatementDayFor(a.accountType),
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

function toQuoteInput(answers: IntakeQuoteAnswers, today: LocalDate): QuoteInput {
  const serviceKeys = answers.serviceKeys ?? [];
  const services: QuoteServiceInput[] = serviceKeys.map((key) => {
    if (!PRICING[key]) throw new Error(`unknown service key: ${key}`);
    const explicit = answers.serviceQuantities?.[key];
    return { key, quantity: explicit ?? defaultQuantityFor(key, answers) };
  });

  const customItems: CustomItemInput[] = (answers.customItems ?? []).map((item, i) => ({
    key: `custom_item_${i + 1}`,
    product_name: item.productName,
    unit_price: item.unitPrice,
    frequency: item.frequency,
    quantity: item.quantity,
  }));

  // QBO pass-through (owner walkthrough): every QuickBooks status ends on
  // QBO, so any answered status prices the tier line - recommended from the
  // seat count + tracking complexity unless a plan was picked explicitly.
  const qbo = answers.quickbooksStatus
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
    payrollFrequency: answers.payrollFrequency ?? "monthly",
    services,
    customItems,
    qbo,
    retroactive,
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
 * frequency); everything else follows its pricing bucket.
 */
export function buildRecurringServicesTemplate(
  quote: Quote,
  customItems: IntakeCustomItemInput[] = [],
): TemplateLineItem[] {
  return quote.lines.map((line) => {
    const customMatch = line.service_key.startsWith("custom_item_")
      ? customItems[Number(line.service_key.replace("custom_item_", "")) - 1]
      : undefined;
    return {
      service_key: line.service_key,
      product_name: line.product_name,
      unit_price: line.unit_price,
      quantity: line.quantity,
      discount: 0,
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
