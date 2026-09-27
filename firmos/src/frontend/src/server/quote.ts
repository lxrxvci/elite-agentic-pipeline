import {
  calculateQuote,
  isReconciliationBillableAccount,
  parseLocalDate,
  PRICING,
  reportMonthsForFrequency,
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
import type { IntakeCustomItemInput, IntakeFormData, IntakeReportDefinition } from "./intake";
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
 * J2 (meeting #3): the wizard captures missed filings as a yes/no plus the
 * most-recent-filing date; the COUNT derives from that date x the report's
 * cadence through today. Rule: every cadence period strictly after the
 * last-filed month and strictly before the current month is missed (the
 * current period is being worked live, not yet owed - same convention as
 * retroactive bookkeeping). A legacy/extraction raw count passes through.
 */
export function missedFilingsThrough(
  lastFiledDate: string,
  frequency: string,
  today: LocalDate,
): number {
  const months = reportMonthsForFrequency(frequency);
  if (months.length === 0) return 0;
  const last = parseLocalDate(lastFiledDate);
  let count = 0;
  for (let year = last.year; year <= today.year; year++) {
    for (const month of months) {
      const afterLast = year > last.year || (year === last.year && month > last.month);
      const beforeToday = year < today.year || (year === today.year && month < today.month);
      if (afterLast && beforeToday) count += 1;
    }
  }
  return count;
}

/** The quote-facing missed count for one intake report definition. */
function missedCountFor(r: IntakeReportDefinition, today: LocalDate): number | null {
  if (typeof r.missedFilings === "number") return r.missedFilings;
  if (r.missedFilings === true && r.lastFiledDate) {
    // A hand-edited form_data row with an unparseable date derives nothing
    // (the recurring line still prices; no retro line is guessed).
    try {
      return missedFilingsThrough(r.lastFiledDate, r.frequency, today);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * C10: specialty report definitions price into the quote at their own
 * cadence. Only definitions carrying pricing data (hours, a flat price, or a
 * missed-filings count) reach the engine; pure tracking definitions stay out
 * of the money (they still materialize report rows at conversion). The quote
 * line keys (specialty_report_{n}) index into THIS filtered array, so every
 * caller of buildRecurringServicesTemplate must pass the same list.
 *
 * J2: `today` drives the missed-count derivation from lastFiledDate. It
 * defaults to the firm-local today; any caller that also computes the quote
 * with an explicit today (conversion) must pass the SAME today here so the
 * template's retro line quantities match the quote's.
 */
export function specialtyReportsFromIntake(
  answers: Pick<IntakeQuoteAnswers, "reportDefinitions">,
  today: LocalDate = localToday(),
): SpecialtyReportInput[] {
  return (answers.reportDefinitions ?? [])
    .map((r) => ({ def: r, missed: missedCountFor(r, today) }))
    .filter(({ def, missed }) => def.estimatedHours != null || def.flatPrice != null || (missed ?? 0) > 0)
    .map(({ def, missed }) => ({
      name: def.name,
      frequency: def.frequency,
      estimatedHours: def.estimatedHours ?? null,
      flatPrice: def.flatPrice ?? null,
      hourlyRate: def.hourlyRate ?? null,
      missedFilings: missed,
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

  // J2 (meeting #3): the 1099 estimated count is captured whenever ANY 1099
  // service level is on, and it always prices count x the per-filing rate
  // (admin-configurable, $10 default). Collection/management answers ride
  // the same per-filing line; an explicit per-filing pick already carries
  // the count via defaultQuantityFor, so it is never duplicated.
  const estimated1099 = answers.estimated1099Count ?? null;
  if (
    estimated1099 != null &&
    estimated1099 > 0 &&
    !requestedHas(services, "1099_per_filing") &&
    (requestedHas(services, "1099_collection") || requestedHas(services, "1099_full_management"))
  ) {
    services.push({ key: "1099_per_filing", quantity: estimated1099 });
  }

  const customItems: CustomItemInput[] = (answers.customItems ?? []).map((item, i) => ({
    key: `custom_item_${i + 1}`,
    product_name: item.productName,
    unit_price: item.unitPrice,
    frequency: item.frequency,
    quantity: item.quantity,
  }));

  // C10 specialty reports: see specialtyReportsFromIntake (only priced
  // definitions reach the engine). J2: the same `today` threads into the
  // missed-count derivation so the quote and the template agree.
  const specialtyReports = specialtyReportsFromIntake(answers, today);

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
    // J4 (V4): direct per-line price overrides ride the quote-level map so
    // every line - services, QBO pass-through, custom items, specialty
    // reports - honors the review screen's price edits uniformly.
    servicePrices: answers.servicePrices ?? undefined,
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
 * J4 (V4): a direct price override carries as the EQUIVALENT per-cycle
 * discount (the invoice engine bills unit_price x quantity - discount, so
 * the discounted rate lands exactly on the overridden price and still
 * scales with live quantities), plus the raw `price_override` field for
 * transparency. An override on an unpriced line cannot express as a
 * discount (no standard amount) - the raw field carries and the line keeps
 * its priced-at-review note.
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
    // J4 (V4): the equivalent per-cycle discount for a direct price
    // override, derived from the line's GROSS (unit price x quantity - the
    // retro line's amount already IS the override after repricing, so
    // amount-minus-override would wrongly zero it). Legacy discounts carry
    // verbatim when no override exists.
    const discount =
      line.price_override != null && line.unit_price != null
        ? round2(Math.max(0, line.unit_price * line.quantity - line.price_override))
        : (line.discount ?? 0);
    const overrideField =
      line.price_override != null ? { price_override: line.price_override } : {};
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
        discount,
        ...overrideField,
        frequency: isRetro ? "one_time" : (report?.frequency ?? "monthly"),
        notes: line.unpriced ? "Priced manually: no amount stated in HANDOFF §15." : null,
      };
    }
    return {
      service_key: line.service_key,
      product_name: line.product_name,
      unit_price: line.unit_price,
      quantity: line.quantity,
      discount,
      ...overrideField,
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

const requestedHas = (services: QuoteServiceInput[], key: string): boolean =>
  services.some((s) => s.key === key);

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
