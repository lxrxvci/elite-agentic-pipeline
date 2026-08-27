/**
 * @firmos/domain - the pricing engine (HANDOFF §6.5/§15, routes_quotes.py).
 *
 * The PRICING table is ported verbatim - every dollar amount below is stated
 * in HANDOFF §15. A few lines the handoff names without an amount
 * (process_payroll per-period price, daily/weekly reporting, specialty
 * reports) carry unit_price: null and are flagged `unpriced` on quote lines
 * rather than guessed. Retroactive bookkeeping is the exception: §15 states
 * no amount, but the owner's walkthrough prices it month by month at the
 * quote's own effective monthly rate, so calculateQuote fills the line in
 * when it is handed the scope (start date + current month).
 *
 * Pure: calculate_quote() takes duck-typed intake answers and returns line
 * items plus totals; no DB, no clock (the current month is a parameter).
 */

import { FEBRUARY_BILLED_SERVICE_KEYS } from "./billing.ts";
import { diffMonths, parseLocalDate, type Month } from "./dates.ts";

export type PricingBucket = "one_time" | "monthly" | "quarterly" | "annual" | "payroll_monthly";

/**
 * How a service's quote quantity is derived (HANDOFF §15 "Quantity scaling"):
 *  - flat_monthly:        quantity = billing cycle months
 *  - per_unit_monthly:    live unit count (accounts / classes / locations) × cycle
 *  - payroll_per_period:  payroll periods-per-month × cycle
 *  - fixed:               the raw quantity given (filings, hours, one-time jobs)
 */
export type PricingScaling = "flat_monthly" | "per_unit_monthly" | "payroll_per_period" | "fixed";

export interface PricingEntry {
  product_name: string;
  group:
    | "one_time"
    | "core_monthly"
    | "reporting"
    | "tracking"
    | "1099"
    | "payroll"
    | "consulting"
    | "other";
  /** null where HANDOFF §15 names the service without stating an amount */
  unit_price: number | null;
  unit: string;
  scaling: PricingScaling;
  bucket: PricingBucket;
}

/** HANDOFF §15 PRICING table, grouped exactly as the handoff groups it. */
export const PRICING: Record<string, PricingEntry> = {
  // One-time
  qbo_setup: { product_name: "QBO Setup", group: "one_time", unit_price: 150, unit: "one_time", scaling: "fixed", bucket: "one_time" }, // $150 min
  initial_payroll_setup: { product_name: "Initial Payroll Setup", group: "one_time", unit_price: 150, unit: "one_time", scaling: "fixed", bucket: "one_time" }, // $150 min
  // Core monthly
  bank_feed_management: { product_name: "Bank Feed Management", group: "core_monthly", unit_price: 100, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $100 min
  account_reconciliations: { product_name: "Account Reconciliations", group: "core_monthly", unit_price: 25, unit: "account", scaling: "per_unit_monthly", bucket: "monthly" },
  merchant_account_reconciliation: { product_name: "Merchant Account Reconciliation", group: "core_monthly", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $25 min
  loans_and_liabilities: { product_name: "Loans and Liabilities", group: "core_monthly", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $25 min
  invoicing: { product_name: "Invoicing", group: "core_monthly", unit_price: 100, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $100 min
  payment_processing: { product_name: "Payment Processing", group: "core_monthly", unit_price: 100, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $100 min
  record_bills: { product_name: "Record Bills", group: "core_monthly", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" }, // $25 min
  // Reporting - monthly at three close tiers; quarterly/semi-annual/annual at $25
  monthly_reporting_5: { product_name: "Monthly Reporting (close by the 5th)", group: "reporting", unit_price: 100, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  monthly_reporting_10: { product_name: "Monthly Reporting (close by the 10th)", group: "reporting", unit_price: 50, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  monthly_reporting_15: { product_name: "Monthly Reporting (close by the 15th)", group: "reporting", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  quarterly_reporting: { product_name: "Quarterly Reporting", group: "reporting", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  semi_annual_reporting: { product_name: "Semi-Annual Reporting", group: "reporting", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  annual_reporting: { product_name: "Annual Reporting", group: "reporting", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  daily_reporting: { product_name: "Daily Reporting", group: "reporting", unit_price: null, unit: "unit", scaling: "per_unit_monthly", bucket: "monthly" }, // per unit; amount not stated in §15
  weekly_reporting: { product_name: "Weekly Reporting", group: "reporting", unit_price: null, unit: "unit", scaling: "per_unit_monthly", bucket: "monthly" }, // per unit; amount not stated in §15
  // Tracking
  class_tracking: { product_name: "Class Tracking", group: "tracking", unit_price: 25, unit: "class", scaling: "per_unit_monthly", bucket: "monthly" },
  location_tracking: { product_name: "Location Tracking", group: "tracking", unit_price: 25, unit: "location", scaling: "per_unit_monthly", bucket: "monthly" },
  // 1099 (February-billed, HANDOFF §6.5)
  "1099_collection": { product_name: "1099 Collection", group: "1099", unit_price: 50, unit: "year", scaling: "fixed", bucket: "annual" },
  "1099_full_management": { product_name: "1099 Full Management", group: "1099", unit_price: 250, unit: "year", scaling: "fixed", bucket: "annual" },
  "1099_per_filing": { product_name: "1099 Per Filing", group: "1099", unit_price: 10, unit: "filing", scaling: "fixed", bucket: "annual" },
  // Payroll
  payroll_quarterly_filings: { product_name: "Payroll Quarterly Filings", group: "payroll", unit_price: 45, unit: "quarter", scaling: "fixed", bucket: "quarterly" },
  payroll_state_local_payments: { product_name: "Payroll State and Local Payments", group: "payroll", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "payroll_monthly" },
  payroll_hours_commission_calculations: { product_name: "Payroll Hours and Commission Calculations", group: "payroll", unit_price: 25, unit: "month", scaling: "flat_monthly", bucket: "payroll_monthly" }, // $25 min
  process_payroll: { product_name: "Process Payroll", group: "payroll", unit_price: null, unit: "pay_period", scaling: "payroll_per_period", bucket: "payroll_monthly" }, // per pay period; amount not stated in §15
  payroll_corrections: { product_name: "Payroll Corrections", group: "payroll", unit_price: 150, unit: "hour", scaling: "fixed", bucket: "one_time" },
  // Consulting - the three named rates
  consulting_tier_1: { product_name: "Consulting (Tier 1)", group: "consulting", unit_price: 150, unit: "hour", scaling: "fixed", bucket: "one_time" },
  consulting_tier_2: { product_name: "Consulting (Tier 2)", group: "consulting", unit_price: 100, unit: "hour", scaling: "fixed", bucket: "one_time" },
  consulting_tier_3: { product_name: "Consulting (Tier 3)", group: "consulting", unit_price: 75, unit: "hour", scaling: "fixed", bucket: "one_time" },
  // Other
  specialty_reports: { product_name: "Specialty Reports", group: "other", unit_price: null, unit: "report", scaling: "fixed", bucket: "one_time" }, // amount not stated in §15
  additional_therapist_tracking: { product_name: "Additional Therapist Tracking", group: "other", unit_price: 100, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  retroactive_bookkeeping: { product_name: "Retroactive Bookkeeping", group: "other", unit_price: null, unit: "project", scaling: "fixed", bucket: "one_time" }, // amount not stated in §15
  quickbooks_simple_start: { product_name: "QuickBooks Simple Start (pass-through)", group: "other", unit_price: 30, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  quickbooks_essentials: { product_name: "QuickBooks Essentials (pass-through)", group: "other", unit_price: 60, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  quickbooks_plus: { product_name: "QuickBooks Plus (pass-through)", group: "other", unit_price: 90, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
  quickbooks_advanced: { product_name: "QuickBooks Advanced (pass-through)", group: "other", unit_price: 200, unit: "month", scaling: "flat_monthly", bucket: "monthly" },
};

/**
 * Admin-configurable price overrides (owner call notes: the pricing table is
 * editable in admin, so a QuickBooks price increase never needs a code
 * change). Keyed by PRICING key; a number replaces the entry's unit_price,
 * null/undefined falls back to the default. Unknown keys are ignored - the
 * server layer validates keys before they are ever stored.
 */
export type PricingOverrides = Partial<Record<string, number | null | undefined>>;

/**
 * PRICING with overrides merged over it. Returns the PRICING table itself
 * when there is nothing to merge, so the no-override path is identical.
 */
export function mergedPricing(overrides?: PricingOverrides | null): Record<string, PricingEntry> {
  if (!overrides) return PRICING;
  let merged: Record<string, PricingEntry> | null = null;
  for (const [key, price] of Object.entries(overrides)) {
    const entry = PRICING[key];
    if (!entry || price == null) continue;
    merged ??= { ...PRICING };
    merged[key] = { ...entry, unit_price: price };
  }
  return merged ?? PRICING;
}

export type ReportFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";
export type PayrollFrequency = "weekly" | "biweekly" | "semi_monthly" | "monthly";

// ── QuickBooks tier recommendation (owner walkthrough) ────────────────────

export type QboTier = "simple_start" | "essentials" | "plus" | "advanced";

/** Tier -> the pass-through service key in PRICING. */
export const QBO_TIER_SERVICE_KEY: Record<QboTier, string> = {
  simple_start: "quickbooks_simple_start",
  essentials: "quickbooks_essentials",
  plus: "quickbooks_plus",
  advanced: "quickbooks_advanced",
};

export const QBO_TIER_LABEL: Record<QboTier, string> = {
  simple_start: "QuickBooks Simple Start",
  essentials: "QuickBooks Essentials",
  plus: "QuickBooks Plus",
  advanced: "QuickBooks Advanced",
};

export interface QboTierInput {
  /** Seats needed in QuickBooks; null/undefined counts as one (the owner). */
  userCount?: number | null;
  classTracking?: boolean | null;
  locationTracking?: boolean | null;
  /** A plan picked by hand always wins over the matrix. */
  explicitTier?: QboTier | null;
}

/**
 * The owner's tier matrix, stated on the walkthrough call: "If they need two
 * users, at least Essentials. Four users, Plus. Class tracking or location
 * tracking, Plus." Seats map onto the plan limits: Simple Start seats 1,
 * Essentials 3, Plus 5, Advanced beyond that. Tracking complexity (class or
 * location) floors the recommendation at Plus. An explicit choice wins.
 */
export function recommendedQboTier(input: QboTierInput): QboTier {
  if (input.explicitTier) return input.explicitTier;
  const users = Math.max(1, Math.floor(input.userCount ?? 1));
  let tier: QboTier =
    users <= 1 ? "simple_start" : users <= 3 ? "essentials" : users <= 5 ? "plus" : "advanced";
  if ((input.classTracking || input.locationTracking) && (tier === "simple_start" || tier === "essentials")) {
    tier = "plus";
  }
  return tier;
}

/** Inverse of QBO_TIER_SERVICE_KEY; null for non-QBO keys. */
export function qboTierForServiceKey(serviceKey: string): QboTier | null {
  for (const [tier, key] of Object.entries(QBO_TIER_SERVICE_KEY) as Array<[QboTier, string]>) {
    if (key === serviceKey) return tier;
  }
  return null;
}

/** HANDOFF §15: the billing cycle multiplier derives from the report frequency. */
export function billingCycleMonths(reportFrequency?: string | null): number {
  switch (reportFrequency) {
    case "quarterly":
      return 3;
    case "semi_annual":
      return 6;
    case "annual":
      return 12;
    default:
      return 1;
  }
}

/** HANDOFF §15: payroll periods-per-month - weekly 52/12, biweekly 26/12, semi-monthly 2, monthly 1. */
export function payrollPeriodsPerMonth(frequency: PayrollFrequency): number {
  switch (frequency) {
    case "weekly":
      return 52 / 12;
    case "biweekly":
      return 26 / 12;
    case "semi_monthly":
      return 2;
    case "monthly":
      return 1;
  }
}

export interface EffectiveMonthlyTotals {
  totalMonthly: number;
  totalQuarterly: number;
  annualExcludingFebruaryBilled: number;
  totalPayrollMonthly: number;
}

/** HANDOFF §15, the formula verbatim. */
export function effectiveMonthly(t: EffectiveMonthlyTotals, billingCycle: number): number {
  return (
    t.totalMonthly / billingCycle +
    t.totalQuarterly / 3 +
    t.annualExcludingFebruaryBilled / 12 +
    t.totalPayrollMonthly / billingCycle
  );
}

export interface QuoteServiceInput {
  key: string;
  /** Raw units: live account/class/location counts, filings, hours. Ignored for flat services. */
  quantity?: number;
}

export type CustomItemFrequency = "weekly" | "daily" | "monthly" | "quarterly" | "semi_annual";

export interface CustomItemInput {
  key: string; // custom_item_{n}
  product_name: string;
  unit_price: number;
  frequency: CustomItemFrequency;
  quantity?: number;
}

export interface QuoteInput {
  /** How often the books are closed; drives the billing cycle multiplier. */
  reportFrequency?: string | null;
  payrollFrequency?: PayrollFrequency;
  services?: QuoteServiceInput[];
  customItems?: CustomItemInput[];
  /**
   * Present when the client has (or is getting) QuickBooks Online: the quote
   * carries the pass-through line for the recommended tier (or the explicit
   * pick) so the estimate reflects the real subscription cost.
   */
  qbo?: QboTierInput | null;
  /**
   * Retroactive bookkeeping scope. Required to PRICE the
   * retroactive_bookkeeping service; without it that line stays unpriced
   * ("quoted at review").
   */
  retroactive?: RetroactiveQuoteInput | null;
}

/**
 * Retroactive scope (owner walkthrough): cleanup is priced month by month
 * from the bookkeeping start date up to the current month. `startDate` is
 * the first month of the books (ISO-local YYYY-MM-DD); `currentMonth` is a
 * parameter, never a clock read (HANDOFF §30 convention 4).
 */
export interface RetroactiveQuoteInput {
  startDate: string;
  currentMonth: Month;
}

export interface QuoteLine {
  service_key: string;
  product_name: string;
  unit_price: number | null;
  quantity: number;
  /** null when the handoff states no price for the service */
  amount: number | null;
  bucket: PricingBucket;
  unpriced: boolean;
}

export interface QuoteTotals extends EffectiveMonthlyTotals {
  totalFebruaryBilledAnnual: number;
  totalOneTime: number;
  effectiveMonthly: number;
}

export interface Quote {
  billingCycle: number;
  lines: QuoteLine[];
  totals: QuoteTotals;
  /**
   * The QBO pass-through line on this quote: which tier, its service key,
   * and whether it came from the recommendation matrix (recommended) or an
   * explicit pick. null when the client is not on (or getting) QBO.
   */
  qbo?: { tier: QboTier; serviceKey: string; recommended: boolean } | null;
  /**
   * Priced retroactive cleanup (owner walkthrough): the elapsed months from
   * the bookkeeping start date up to the current month, billed ONE TIME at
   * the quote's own effective monthly rate. One-time money never feeds back
   * into totals.effectiveMonthly. null when retroactive work is unpriced
   * (no start date / no current month) or not in scope.
   */
  retroactive?: {
    months: number;
    startMonth: Month;
    perMonthRate: number;
    total: number;
  } | null;
}

/**
 * HANDOFF §15 custom-item scaling by the item's own frequency: weekly × 4,
 * daily × 22, quarterly by cycle/3, semi-annual by cycle/6. The weekly/daily
 * multipliers are per month, so they scale with the cycle like every other
 * monthly quantity (HANDOFF §30 convention 9); the quarterly/semi-annual
 * forms already carry the cycle.
 */
export function customItemQuantity(frequency: CustomItemFrequency, cycle: number, base = 1): number {
  switch (frequency) {
    case "weekly":
      return base * 4 * cycle;
    case "daily":
      return base * 22 * cycle;
    case "monthly":
      return base * cycle;
    case "quarterly":
      return (base * cycle) / 3;
    case "semi_annual":
      return (base * cycle) / 6;
  }
}

function serviceQuantity(
  entry: PricingEntry,
  rawQuantity: number | undefined,
  cycle: number,
  payrollFrequency: PayrollFrequency,
): number {
  switch (entry.scaling) {
    case "flat_monthly":
      return cycle;
    case "per_unit_monthly":
      return (rawQuantity ?? 1) * cycle;
    case "payroll_per_period":
      return payrollPeriodsPerMonth(payrollFrequency) * cycle;
    case "fixed":
      return rawQuantity ?? 1;
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** HANDOFF §15 calculate_quote(): intake answers → full quote. */
export function calculateQuote(input: QuoteInput, pricingOverrides?: PricingOverrides | null): Quote {
  const pricing = mergedPricing(pricingOverrides);
  const cycle = billingCycleMonths(input.reportFrequency);
  const payrollFrequency = input.payrollFrequency ?? "monthly";
  const lines: QuoteLine[] = [];

  const requestedKeys = new Set((input.services ?? []).map((s) => s.key));

  for (const svc of input.services ?? []) {
    const entry = pricing[svc.key];
    if (!entry) throw new Error(`unknown service key: ${svc.key}`);
    const quantity = serviceQuantity(entry, svc.quantity, cycle, payrollFrequency);
    lines.push({
      service_key: svc.key,
      product_name: entry.product_name,
      unit_price: entry.unit_price,
      quantity,
      amount: entry.unit_price == null ? null : entry.unit_price * quantity,
      bucket: entry.bucket,
      unpriced: entry.unit_price == null,
    });
  }

  // QBO pass-through (owner walkthrough): when the client has or is getting
  // QuickBooks, the quote carries the subscription line at the recommended
  // tier. A quickbooks_* key already in services is the explicit pick and is
  // never duplicated; an explicitTier on the input wins over the matrix.
  let qbo: Quote["qbo"] = null;
  if (input.qbo) {
    const explicitKey = (input.services ?? [])
      .map((s) => s.key)
      .find((k) => qboTierForServiceKey(k) != null);
    if (explicitKey) {
      qbo = { tier: qboTierForServiceKey(explicitKey)!, serviceKey: explicitKey, recommended: false };
    } else {
      const tier = recommendedQboTier(input.qbo);
      const serviceKey = QBO_TIER_SERVICE_KEY[tier];
      const entry = pricing[serviceKey];
      lines.push({
        service_key: serviceKey,
        product_name: entry.product_name,
        unit_price: entry.unit_price,
        quantity: cycle,
        amount: entry.unit_price == null ? null : entry.unit_price * cycle,
        bucket: entry.bucket,
        unpriced: false,
      });
      qbo = { tier, serviceKey, recommended: input.qbo.explicitTier == null };
    }
  }

  for (const item of input.customItems ?? []) {
    const quantity = customItemQuantity(item.frequency, cycle, item.quantity ?? 1);
    lines.push({
      service_key: item.key,
      product_name: item.product_name,
      unit_price: item.unit_price,
      quantity,
      amount: item.unit_price * quantity,
      bucket: "monthly",
      unpriced: false,
    });
  }

  const totals: QuoteTotals = {
    totalMonthly: 0,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalFebruaryBilledAnnual: 0,
    totalPayrollMonthly: 0,
    totalOneTime: 0,
    effectiveMonthly: 0,
  };
  for (const line of lines) {
    if (line.amount == null) continue;
    switch (line.bucket) {
      case "monthly":
        totals.totalMonthly += line.amount;
        break;
      case "quarterly":
        totals.totalQuarterly += line.amount;
        break;
      case "annual":
        // HANDOFF §15: February-billed services are excluded from the annual term
        if (FEBRUARY_BILLED_SERVICE_KEYS.has(line.service_key)) {
          totals.totalFebruaryBilledAnnual += line.amount;
        } else {
          totals.annualExcludingFebruaryBilled += line.amount;
        }
        break;
      case "payroll_monthly":
        totals.totalPayrollMonthly += line.amount;
        break;
      case "one_time":
        totals.totalOneTime += line.amount;
        break;
    }
  }
  totals.effectiveMonthly = effectiveMonthly(totals, cycle);

  // Retroactive bookkeeping, priced (owner walkthrough): the cleanup months
  // are the elapsed months from the bookkeeping start date up to the current
  // month - the current month itself is worked live, not retroactively. Each
  // month is one line item billed at the quote's own effective monthly rate,
  // totalled as a ONE-TIME amount, so it never inflates effectiveMonthly.
  // Without a start date / current month the line stays unpriced; with a
  // zero effective rate there is nothing to price against, same outcome.
  let retroactive: Quote["retroactive"] = null;
  if (requestedKeys.has("retroactive_bookkeeping") && input.retroactive && totals.effectiveMonthly > 0) {
    const start = parseLocalDate(input.retroactive.startDate);
    const startMonth: Month = { year: start.year, month: start.month };
    const months = Math.max(0, diffMonths(startMonth, input.retroactive.currentMonth));
    const perMonthRate = round2(totals.effectiveMonthly);
    const total = round2(perMonthRate * months);
    const line = lines.find((l) => l.service_key === "retroactive_bookkeeping");
    if (line) {
      line.unit_price = perMonthRate;
      line.quantity = months;
      line.amount = total;
      line.unpriced = false;
    }
    totals.totalOneTime += total;
    retroactive = { months, startMonth, perMonthRate, total };
  }

  return { billingCycle: cycle, lines, totals, qbo, retroactive };
}
