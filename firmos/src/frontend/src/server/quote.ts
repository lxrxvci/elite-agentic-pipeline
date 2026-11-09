import {
  calculateQuote,
  isFebruaryBilledService,
  isReconciliationBillableAccount,
  parseLocalDate,
  PRICING,
  reportMonthsForFrequency,
  type CustomItemInput,
  type LocalDate,
  type PricingEntry,
  type PricingOverrides,
  type Quote,
  type QuoteInput,
  type QuoteServiceInput,
  type SpecialtyReportInput,
} from "@firmos/domain";
import {
  defaultLineBilling,
  resolveLineBilling,
  type LineBillingConfig,
} from "@/shared/lib/line-billing";
import type { RoutineSchedule } from "@/shared/lib/routine-schedule";
import { estimateLineBucket, taskKeysFor } from "@/components/intake/review-estimate";

import { statementDayForIntakeAccount } from "./accounts-seed";
import { accountLabel } from "@/shared/lib/account-label";
import { getCustomServiceEntries } from "./services-catalog";
import { localToday } from "./dates";
import type { IntakeCustomItemInput, IntakeCustomRuleInput, IntakeFormData, IntakeReportDefinition } from "./intake";
import { getPricingOverrides, getRateTiers } from "./pricing-config";

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
      // L4 (G7, 10_06 01:16:53): excluded accounts drop out of the factor -
      // "it pulls the four accounts but I can't select 25 per account." The
      // exclusion list carries the normalized account labels (accountLabel).
      const excluded = new Set((answers.reconExcludedAccounts ?? []).map((n) => n.trim().toLowerCase()));
      const all = [
        // I3: the proof category drives the statement day (statement-proof
        // accounts reconcile monthly; owner-declared/bill-of-sale don't).
        ...accounts.map((a) => ({
          account_type: a.accountType,
          statement_day: statementDayForIntakeAccount(a),
          label: accountLabel({ institution: a.institution, accountType: a.accountType, last4: a.last4 }),
        })),
        ...merchants.map((m, i) => ({
          account_type: m.account_type,
          statement_day: m.statement_day,
          label: (answers.merchantAccounts ?? [])[i]?.name ?? `Merchant ${i + 1}`,
        })),
      ];
      return all.filter(
        (a) => isReconciliationBillableAccount(a) && !excluded.has(a.label.trim().toLowerCase()),
      ).length;
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
 * C10: specialty report definitions enter the quote at their own cadence.
 * Reports without pricing remain visible as unpriced lines instead of
 * disappearing from review. The quote line keys (specialty_report_{n}) index
 * into THIS filtered array, so every caller of buildRecurringServicesTemplate
 * must pass the same list.
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
    .map((r) => {
      // L3 (10_06): the three tier fields fold into tierHours; a mode never
      // picked falls back to the populated fields (legacy rows).
      const tierHours =
        r.tierHours != null
          ? r.tierHours
          : (() => {
              const fromItem = (k: string) => {
                const v = (r as unknown as Record<string, unknown>)[k]
                const n = typeof v === 'number' ? v : v == null || v === '' ? null : Number(v)
                return n != null && Number.isFinite(n) && n > 0 ? n : null
              }
              const hours = {
                bookkeeper: fromItem('tierBookkeeperHours'),
                manager: fromItem('tierManagerHours'),
                owner: fromItem('tierOwnerHours'),
              }
              return hours.bookkeeper != null || hours.manager != null || hours.owner != null ? hours : null
            })()
      const missed = missedCountFor(r, today)
      return { def: r, missed, tierHours }
    })
    .filter(({ def }) => def.name.trim() !== "" && def.frequency.trim() !== "")
    .map(({ def, missed, tierHours }) => ({
      name: def.name,
      frequency: def.frequency,
      estimatedHours: def.estimatedHours ?? null,
      flatPrice: def.pricingMode === 'hours' ? null : (def.flatPrice ?? null),
      hourlyRate: def.hourlyRate ?? null,
      tierHours,
      missedFilings: missed,
    }));
}

function toQuoteInput(
  answers: IntakeQuoteAnswers,
  today: LocalDate,
  customEntries?: Record<string, PricingEntry> | null,
  rateTiers?: QuoteInput["rateTiers"],
): QuoteInput {
  const serviceKeys = answers.serviceKeys ?? [];
  const services: QuoteServiceInput[] = serviceKeys.map((key) => {
    // K3: catalog (admin-created) service keys are valid alongside PRICING.
    if (!PRICING[key] && !customEntries?.[key]) throw new Error(`unknown service key: ${key}`);
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

  // L1 (H1, 10_06 00:37:30): recurring custom work PRICES in the estimate -
  // a billable custom rule ("Walk my dog, monthly, $150") was landing on the
  // routine scheduler but never reaching the quote. Frequency scaling is the
  // engine's (weekly x4 / daily x22 / quarterly /3 / annual /12).
  for (const [j, rule] of (answers.customRecurringRules ?? []).entries()) {
    if (rule.isBillable !== true || rule.unitPrice == null) continue;
    const price = Number(rule.unitPrice);
    if (!Number.isFinite(price) || price < 0) continue;
    customItems.push({
      key: `custom_rule_${j + 1}`,
      product_name: rule.title,
      unit_price: price,
      frequency: rule.scheduleType,
    });
  }

  // C10 specialty reports: see specialtyReportsFromIntake (only priced
  // definitions reach the engine). J2: the same `today` threads into the
  // missed-count derivation so the quote and the template agree.
  const specialtyReports = specialtyReportsFromIntake(answers, today);

  // QBO pass-through applies only to canonical QuickBooks statuses and legacy
  // aliases. Wave, Xero, and other accounting software never inherit QBO pricing.
  const qbo = ["existing", "desktop", "none", "has_qbo"].includes(String(answers.quickbooksStatus))
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
    // K6 (D6): the retro bulk discount rides with the scope.
    retroDiscountPercent: answers.retroDiscountPercent ?? undefined,
    // L3 (10_06): the admin difficulty tiers behind tier-hour report pricing.
    rateTiers: rateTiers ?? undefined,
  };
}

function legacyCycleNetForCalcRate(
  line: Quote["lines"][number],
  cycle: number,
  config: LineBillingConfig,
  calcQuantity: number,
): number | null {
  const rate = config.calcUnitPrice
  if (rate == null) return null
  const monthlyRate = config.flatMonthly === true
    ? rate * calcQuantity
    : config.calcFrequency === "monthly"
      ? rate * calcQuantity
      : config.calcFrequency === "quarterly"
        ? (rate * calcQuantity) / 3
        : config.calcFrequency === "annual"
          ? (rate * calcQuantity) / 12
          : config.calcFrequency === "weekly"
            ? rate * calcQuantity * 4
            : rate * calcQuantity * 22
  const amount = line.bucket === "monthly" || line.bucket === "payroll_monthly"
    ? monthlyRate * cycle
    : line.bucket === "quarterly"
      ? monthlyRate * 3
      : line.bucket === "annual"
        ? monthlyRate * 12
        : rate * calcQuantity
  return Math.round(amount * 100) / 100
}

function calcRateServicePrices(answers: IntakeQuoteAnswers, quote: Quote): Record<string, number> {
  const prices: Record<string, number> = {}
  const schedule = answers.routineSchedule ?? null
  for (const line of quote.lines) {
    const override = answers.lineBilling?.[line.service_key]
    if (override?.calcUnitPrice == null) continue
    const bucket = estimateLineBucket(line, schedule, answers.reportDefinitions)
    if (bucket == null) continue
    const scheduleEntry = taskKeysFor(line)
      .map((key) => schedule?.[key])
      .find((entry) => entry != null)
    const config = resolveLineBilling(
      defaultLineBilling({
        bucket,
        scheduleWeekdays: scheduleEntry?.weekdays ?? null,
        closingFrequency: answers.bookkeepingFrequency ?? "monthly",
        billMonth: answers.billingMonths?.[line.service_key] ?? (isFebruaryBilledService(line.service_key) ? 2 : null),
      }),
      override,
    )
    const amount = legacyCycleNetForCalcRate(line, quote.billingCycle, config, 1)
    if (amount != null) prices[line.service_key] = amount
  }
  return prices
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
  customEntries?: Record<string, PricingEntry> | null,
  rateTiers?: QuoteInput["rateTiers"],
): Quote {
  const input = toQuoteInput(answers, today, customEntries, rateTiers)
  const preliminary = calculateQuote(input, pricingOverrides, customEntries)
  const calcPrices = calcRateServicePrices(answers, preliminary)
  if (Object.keys(calcPrices).length === 0) return preliminary
  return calculateQuote(
    { ...input, servicePrices: { ...input.servicePrices, ...calcPrices } },
    pricingOverrides,
    customEntries,
  )
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
  // K3: admin-created catalog services price alongside the canonical table.
  // L3: the admin difficulty tiers price tier-hour specialty reports.
  const [overrides, customEntries, rateTiers] = await Promise.all([
    getPricingOverrides(),
    getCustomServiceEntries(),
    getRateTiers(),
  ]);
  return calculateIntakeQuote(answers, today, overrides, customEntries, rateTiers);
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
 * Specialty report lines (C10): quantity stays cycle-normalized for legacy
 * totals while calc_quantity preserves natural occurrences for the resolved
 * billing model. The report's own frequency and calculation-rate overrides
 * therefore bill consistently in preview, templates, and invoices. Retro
 * missed-filings lines store as one_time.
 */
export function buildRecurringServicesTemplate(
  quote: Quote,
  customItems: IntakeCustomItemInput[] = [],
  specialtyReports: SpecialtyReportInput[] = [],
  customRules: IntakeCustomRuleInput[] = [],
  // L4 (G9, 10_06 01:21:18): billing-month assignments ride onto the
  // template as bill_month - the invoice engine bills the line's full
  // quantity in that month instead of spreading it across the year.
  billingMonths: Record<string, number | null> = {},
  // M3 (10_10, 01:03:54): the per-line billing model rides too - the
  // resolved calc/billing frequencies and date selectors stamp onto every
  // template line ("Billing frequency is different than frequency").
  lineBilling: Record<string, Partial<LineBillingConfig>> = {},
  billingDefaults: { closingFrequency?: string; routineSchedule?: RoutineSchedule | null; retroBillingFrequency?: string | null } = {},
): TemplateLineItem[] {
  const schedule = billingDefaults.routineSchedule ?? null
  const closingFrequency = billingDefaults.closingFrequency ?? 'monthly'
  return quote.lines.map((line) => {
    // M3: the line's resolved billing model (defaults from its cadence, the
    // schedule's weekdays, the closing frequency, and any L4 month
    // assignment; form_data overrides on top).
    const scheduleEntry = taskKeysFor(line)
      .map((k) => schedule?.[k])
      .find((e) => e != null)
    // The display bucket's source order mirrors the estimate's: the
    // committed schedule wins; a specialty report's OWN frequency is next
    // (the engine normalizes annual reports into the monthly cycle);
    // the engine bucket falls back last.
    const specialtyPreMatch = line.service_key.match(/^specialty_report_(\d+)(_retro)?$/)
    const reportFrequency = specialtyPreMatch
      ? specialtyReports[Number(specialtyPreMatch[1]) - 1]?.frequency
      : undefined
    const bucketForLine =
      line.bucket === 'annual' || line.bucket === 'quarterly'
        ? line.bucket
        : (scheduleEntry?.bucket ??
          (reportFrequency === 'annual' || reportFrequency === 'quarterly' ? reportFrequency : 'monthly'))
    // §6.5 keeps its meaning here: bill_month stamps only EXPLICIT
    // assignments (L4's map or an M3 override) - the February default is
    // an estimate-display default, never stamped, so the invoice's
    // anchor-year rule for unassigned 1099s survives.
    const explicitMonth = billingMonths[line.service_key] ?? null
    const billing = resolveLineBilling(
      defaultLineBilling({
        bucket: bucketForLine,
        scheduleWeekdays: scheduleEntry?.weekdays ?? null,
        closingFrequency,
        billMonth: explicitMonth,
      }),
      {
        ...(lineBilling[line.service_key] ?? {}),
        ...(explicitMonth != null ? { billMonth: explicitMonth } : {}),
      },
    )
    const billingFields = {
      bill_frequency: billing.billingFrequency,
      calc_frequency: billing.calcFrequency,
      calc_weekdays: billing.calcWeekdays ?? null,
      bill_day: billing.billDay ?? null,
      bill_month: billing.billMonth ?? null,
      ...(billing.calcUnitPrice != null
        ? { calc_quantity: 1 }
        : line.calc_quantity != null
          ? { calc_quantity: line.calc_quantity }
          : {}),
      ...(billing.flatMonthly === true ? { flat_monthly: true } : {}),
      // M4 (01:12:43): "normal billing frequency or its own invoice" -
      // flagged lines split onto their own invoice row at generation.
      ...(billing.ownInvoice === true ? { own_invoice: true } : {}),
    }
    const hasCalcRateOverride = billing.calcUnitPrice != null
    const effectiveUnitPrice = billing.calcUnitPrice ?? line.unit_price
    // Legacy per-cycle overrides retain their equivalent-discount behavior.
    // A calculation-rate override instead becomes the template unit price.
    const discount = hasCalcRateOverride
      ? 0
      : line.price_override != null && line.unit_price != null
        ? round2(Math.max(0, line.unit_price * line.quantity - line.price_override))
        : (line.discount ?? 0);
    const overrideField = !hasCalcRateOverride && line.price_override != null
      ? { price_override: line.price_override }
      : {};
    const customMatch = line.service_key.startsWith("custom_item_")
      ? customItems[Number(line.service_key.replace("custom_item_", "")) - 1]
      : undefined;
    // L4 (G8, 10_06 01:04:50): weekly custom rules carry their weekday
    // schedule onto the template line, so the invoice engine bills the
    // actual weekday count per month ("5 Fridays in October, 4 in
    // September") instead of the flat x4 estimate.
    const ruleMatch = line.service_key.match(/^custom_rule_(\d+)$/);
    const customRule = ruleMatch ? customRules[Number(ruleMatch[1]) - 1] : undefined;
    const ruleScheduleFields = customRule
      ? {
          days_of_week: customRule.daysOfWeek ?? null,
          day_of_month: customRule.dayOfMonth ?? null,
          weekday: customRule.weekday ?? null,
          week_of_month: customRule.weekOfMonth ?? null,
          anchor_month: customRule.anchorMonth ?? null,
        }
      : {};
    const specialtyMatch = line.service_key.match(/^specialty_report_(\d+)(_retro)?$/);
    // L4 (G9): an assigned billing month carries verbatim; the invoice
    // engine's periodic branch bills the full quantity in only that month.
    const assignedMonth = billingMonths[line.service_key];
    const billMonthField = assignedMonth != null ? { bill_month: assignedMonth } : {};
    if (specialtyMatch) {
      const report = specialtyReports[Number(specialtyMatch[1]) - 1];
      const isRetro = specialtyMatch[2] != null;
      return {
        service_key: line.service_key,
        product_name: line.product_name,
        unit_price: effectiveUnitPrice,
        quantity: line.quantity,
        discount,
        ...overrideField,
        ...billMonthField,
        ...billingFields,
        frequency: isRetro ? "one_time" : (report?.frequency ?? "monthly"),
        // L3 (F6, 10_06 00:30:45): the tier estimate rides the template -
        // "once an employee is selected their actual billing rate goes into
        // the monthly invoicing." The assigned person's actual rate replaces
        // this estimate at invoicing (Phase 4); until then the line shows
        // the tier assumption.
        notes: line.pricedByTiers
          ? "Difficulty-tier estimate (admin tier rates) - the assigned employee's actual billing rate applies at invoicing."
          : line.unpriced && !hasCalcRateOverride
            ? "Priced manually: no amount stated in HANDOFF §15."
            : null,
      };
    }
    return {
      service_key: line.service_key,
      product_name: line.product_name,
      unit_price: effectiveUnitPrice,
      quantity: line.quantity,
      discount,
      ...overrideField,
      ...billMonthField,
      ...billingFields,
      // M7 (A11, 10_10 00:53:32): the retro cleanup bills in installments
      // at its own frequency (1/3/12 cleanup-months per invoice); unset
      // stays the legacy one-time up-front line.
      ...(line.service_key === "retroactive_bookkeeping" && billingDefaults.retroBillingFrequency
        ? { retro_billing_frequency: billingDefaults.retroBillingFrequency }
        : {}),
      frequency: customRule?.scheduleType ?? customMatch?.frequency ?? BUCKET_FREQUENCY[line.bucket] ?? "monthly",
      ...ruleScheduleFields,
      notes: line.unpriced && !hasCalcRateOverride ? "Priced manually: no amount stated in HANDOFF §15." : null,
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
