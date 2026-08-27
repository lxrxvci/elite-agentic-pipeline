import { and, asc, eq } from "drizzle-orm";
import {
  FEBRUARY_BILLED_SERVICE_KEYS,
  LOAN_ACCOUNT_TYPES,
  PRICING,
  billingCycleMonths,
  effectiveMonthly,
  isReconciliationBillableAccount,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import { accounts, clients, properties, recurringTasks } from "@/db/schema";

import { localToday } from "./dates";
import type { ClientRow } from "./domain-adapters";
import type { IntakeCustomItemInput } from "./intake";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuoteWithConfig,
  mergeManualTemplateLines,
  type TemplateLineItem,
} from "./quote";

/**
 * Live-state billing resync (HANDOFF §15 "Billing sync",
 * client_billing_sync.py).
 *
 * resync_client_billing_from_live_state() rebuilds a client's recurring
 * services template from LIVE state rather than the original intake answers:
 * current active accounts (reconciliation-billable count via the domain
 * predicate, merchant count, loan count), current QBO class/location names,
 * current properties and their mortgages, and the current cadence/tier. It
 * then merges hand-edited (manual_edit) lines back in - a manual line wins
 * outright for its key, manual extras are appended (§6.5) - and restamps the
 * three cached amounts (monthly_recurring_amount, base_monthly_amount,
 * per_account_price).
 *
 * Services the live state cannot speak to (invoicing, payment processing,
 * payroll, QuickBooks pass-throughs, section discounts) are CARRIED verbatim
 * from the existing template; only live-derivable keys are recomputed, and a
 * live-derivable key whose live count dropped to zero falls out of the
 * template (account/property deletes are resync triggers, §15).
 *
 * RESYNC TRIGGERS (§15): other modules call the exported helpers at the
 * bottom of this file - onAccountBillingChanged after account
 * create/update/delete, onPropertyBillingChanged after property
 * create/update/delete, onClientBillingFieldsChanged after a change to any
 * billing-relevant client field (1099 flags/count, QBO class/location names,
 * merchant flag), and onCadenceOrTierChanged after a bookkeeping/billing
 * frequency or close-tier change. Intake billing edits and conversion stamp
 * the template directly (convert.ts); the explicit "resync from intake"
 * endpoint is the one path that discards manual edits and is NOT this file.
 *
 * KNOWN GAP (§29 money bugs): property mortgages are derived from the legacy
 * properties.mortgage_* fields only. Mortgages entered through the pro forma
 * (property_proformas.figures) never bill - the schema has no structured
 * linkage between pro-forma figures and mortgage accounts. Reported, not
 * fixed here (schema is another workstream's).
 */

export const SECTION_DISCOUNT_KEY = "__section_discount__";

/**
 * Service keys the live rebuild owns. A managed key absent from the rebuild
 * (live count zero, flag off) is dropped rather than carried; everything
 * else in the old template is carried verbatim unless it is a custom item
 * (rebuilt from live custom rules) or a manual_edit line (merged back).
 */
const LIVE_MANAGED_KEYS: ReadonlySet<string> = new Set([
  "bank_feed_management",
  "account_reconciliations",
  "merchant_account_reconciliation",
  "loans_and_liabilities",
  "monthly_reporting_5",
  "monthly_reporting_10",
  "monthly_reporting_15",
  "quarterly_reporting",
  "semi_annual_reporting",
  "annual_reporting",
  "class_tracking",
  "location_tracking",
  "1099_collection",
  "1099_full_management",
  "1099_per_filing",
]);

/** Custom-item frequencies the quote engine can scale (§15 quantity scaling). */
const CUSTOM_FREQUENCIES = new Set(["weekly", "daily", "monthly", "quarterly", "semi_annual"]);

function templateLinesOf(client: ClientRow): TemplateLineItem[] {
  return Array.isArray(client.recurringServicesTemplate)
    ? (client.recurringServicesTemplate as TemplateLineItem[])
    : [];
}

/** The reporting service key for the client's current cadence/tier (§15). */
function reportingKeyFor(client: ClientRow): string {
  switch (client.bookkeepingFrequency) {
    case "quarterly":
      return "quarterly_reporting";
    case "semi_annual":
      return "semi_annual_reporting";
    case "annual":
      return "annual_reporting";
    default: {
      const tier = client.monthlyCloseTier == null ? 15 : Number(client.monthlyCloseTier);
      return `monthly_reporting_${tier === 5 || tier === 10 ? tier : 15}`;
    }
  }
}

export interface ResyncResult {
  clientId: number;
  lineCount: number;
  manualLinesKept: number;
  carriedLinesKept: number;
  monthlyRecurringAmount: string;
  baseMonthlyAmount: string | null;
  perAccountPrice: string | null;
}

export async function resyncClientBillingFromLiveState(
  clientId: number,
  // Accepted for the §30 conv. 4 entry-point convention (triggers thread the
  // firm-local today down); the resync math itself is date-independent.
  _today: LocalDate = localToday(),
): Promise<ResyncResult> {
  void _today;
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new Error(`client not found: ${clientId}`);

  const existing = templateLinesOf(client);
  const had = (key: string) => existing.some((l) => l && l.service_key === key);
  const noTemplate = existing.length === 0;

  // ── Live state ──
  const liveAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), eq(accounts.isActive, true)));
  const reconCount = liveAccounts.filter((a) =>
    isReconciliationBillableAccount({
      account_type: a.accountType,
      is_active: a.isActive,
      statement_day: a.statementDay,
    }),
  ).length;
  const merchantCount = liveAccounts.filter((a) =>
    a.accountType.toLowerCase().includes("merchant"),
  ).length;
  const loanAccountCount = liveAccounts.filter((a) =>
    LOAN_ACCOUNT_TYPES.has(a.accountType.toLowerCase()),
  ).length;

  // §29 known gap: mortgages come from the legacy property fields only.
  const liveProperties = await db
    .select()
    .from(properties)
    .where(and(eq(properties.clientId, clientId), eq(properties.isSold, false)));
  const mortgageCount = liveProperties.filter(
    (p) => p.mortgageBalance != null || p.mortgageLender != null,
  ).length;
  const loanCount = loanAccountCount + mortgageCount;

  const classNames = (client.qboClassNames as string[] | null) ?? [];
  const locationNames = (client.qboLocationNames as string[] | null) ?? [];

  // ── Desired live-derivable services ──
  // A brand-new template (legacy client being retired off the frozen path)
  // gets the sensible defaults; an existing template only gains/loses the
  // managed keys the live state justifies.
  const serviceKeys: string[] = [];
  if (noTemplate || had("bank_feed_management")) serviceKeys.push("bank_feed_management");
  if (reconCount > 0 && (noTemplate || had("account_reconciliations"))) {
    serviceKeys.push("account_reconciliations");
  }
  if (merchantCount > 0 || (client.includeMerchantReconciliation && had("merchant_account_reconciliation"))) {
    serviceKeys.push("merchant_account_reconciliation");
  }
  if (loanCount > 0) serviceKeys.push("loans_and_liabilities");
  const reportingKeys = [
    "monthly_reporting_5",
    "monthly_reporting_10",
    "monthly_reporting_15",
    "quarterly_reporting",
    "semi_annual_reporting",
    "annual_reporting",
  ];
  if (noTemplate || reportingKeys.some(had)) serviceKeys.push(reportingKeyFor(client));
  if (classNames.length > 0 && (noTemplate || had("class_tracking"))) {
    serviceKeys.push("class_tracking");
  }
  if (locationNames.length > 0 && (noTemplate || had("location_tracking"))) {
    serviceKeys.push("location_tracking");
  }
  if (client.include1099Collection) serviceKeys.push("1099_collection");
  if (client.include1099FullManagement) serviceKeys.push("1099_full_management");
  if ((client.estimated1099Count ?? 0) > 0) serviceKeys.push("1099_per_filing");

  // ── Custom items from live custom billable rules (§15: keys custom_item_{n},
  //    carrying weekday/days_of_week/anchor_month for invoice-time summing) ──
  const customRules = await db
    .select()
    .from(recurringTasks)
    .where(
      and(
        eq(recurringTasks.clientId, clientId),
        eq(recurringTasks.isCustom, true),
        eq(recurringTasks.isBillable, true),
        eq(recurringTasks.isActive, true),
      ),
    )
    .orderBy(asc(recurringTasks.position), asc(recurringTasks.id));
  const customItems: IntakeCustomItemInput[] = [];
  for (const rule of customRules) {
    if (rule.unitPrice == null) continue;
    if (!CUSTOM_FREQUENCIES.has(rule.scheduleType)) continue; // annual custom rules: no §15 scaling
    customItems.push({
      productName: rule.title,
      unitPrice: Number(rule.unitPrice),
      frequency: rule.scheduleType as IntakeCustomItemInput["frequency"],
      quantity: 1,
    });
  }

  // ── Rebuild through the domain quote engine (§6.5 price flow), priced
  //    against the admin-configured table (pricing overrides merged in) ──
  const quote = await calculateIntakeQuoteWithConfig({
    bookkeepingFrequency: client.bookkeepingFrequency,
    serviceKeys,
    accounts: liveAccounts.map((a) => ({
      name: a.name,
      accountType: a.accountType,
      statementDay: a.statementDay ?? undefined,
    })),
    merchantAccounts: liveAccounts
      .filter((a) => a.accountType.toLowerCase().includes("merchant"))
      .map((a) => ({ name: a.name, processor: a.institution ?? undefined })),
    estimated1099Count: client.estimated1099Count,
    qboClassNames: classNames,
    qboLocationNames: locationNames,
    customItems,
  });
  let rebuilt = buildRecurringServicesTemplate(quote, customItems);

  // Stamp the schedule fields invoicing needs to sum occurrences across the
  // covered months (§15 "anchored ... items are summed across the months the
  // invoice covers"); base_quantity is the per-occurrence quantity.
  rebuilt = rebuilt.map((line) => {
    if (!line.service_key.startsWith("custom_item_")) return line;
    const n = Number(line.service_key.replace("custom_item_", "")) - 1;
    const rule = customRules.filter(
      (r) => r.unitPrice != null && CUSTOM_FREQUENCIES.has(r.scheduleType),
    )[n];
    if (!rule) return line;
    return {
      ...line,
      base_quantity: customItems[n]?.quantity ?? 1,
      days_of_week: rule.daysOfWeek,
      weekday: rule.weekday,
      week_of_month: rule.weekOfMonth,
      day_of_month: rule.dayOfMonth,
      anchor_month: rule.anchorMonth,
    };
  });

  // ── Carry what live state cannot recompute (payroll, invoicing, QBO
  //    pass-throughs, section discounts) - never managed or custom keys ──
  const rebuiltKeys = new Set(rebuilt.map((l) => l.service_key));
  const carried = existing.filter(
    (l) =>
      l &&
      l.manual_edit !== true &&
      !rebuiltKeys.has(l.service_key) &&
      !LIVE_MANAGED_KEYS.has(l.service_key) &&
      !l.service_key.startsWith("custom_item_"),
  );
  const combined = [...rebuilt, ...carried];

  // ── Merge manual edits back (§6.5: manual line wins for its key, manual
  //    extras appended) ──
  const merged = mergeManualTemplateLines(combined, existing);
  const manualLinesKept = existing.filter((l) => l && l.manual_edit === true).length;

  // ── Restamp the three cached amounts from the FINAL template (§15
  //    effective-monthly formula, domain-side) ──
  const cycle = billingCycleMonths(client.bookkeepingFrequency);
  const totals = {
    totalMonthly: 0,
    totalQuarterly: 0,
    annualExcludingFebruaryBilled: 0,
    totalPayrollMonthly: 0,
  };
  for (const line of merged) {
    if (line.unit_price == null) continue;
    const amount = line.unit_price * line.quantity;
    if (line.service_key.startsWith("custom_item_")) {
      totals.totalMonthly += amount;
      continue;
    }
    switch (PRICING[line.service_key]?.bucket ?? "monthly") {
      case "monthly":
        totals.totalMonthly += amount;
        break;
      case "quarterly":
        totals.totalQuarterly += amount;
        break;
      case "annual":
        // §15: February-billed services are excluded from the annual term.
        if (!FEBRUARY_BILLED_SERVICE_KEYS.has(line.service_key)) {
          totals.annualExcludingFebruaryBilled += amount;
        }
        break;
      case "payroll_monthly":
        totals.totalPayrollMonthly += amount;
        break;
      default:
        break; // one_time lines never recur
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const reconLine = merged.find((l) => l.service_key === "account_reconciliations");
  const stamps = {
    monthlyRecurringAmount: round2(effectiveMonthly(totals, cycle)).toFixed(2),
    baseMonthlyAmount: round2(totals.totalMonthly / cycle).toFixed(2),
    perAccountPrice: reconLine?.unit_price != null ? reconLine.unit_price.toFixed(2) : null,
  };

  await db
    .update(clients)
    .set({
      recurringServicesTemplate: merged,
      monthlyRecurringAmount: stamps.monthlyRecurringAmount,
      baseMonthlyAmount: stamps.baseMonthlyAmount,
      perAccountPrice: stamps.perAccountPrice,
      billingLastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId));

  return {
    clientId,
    lineCount: merged.length,
    manualLinesKept,
    carriedLinesKept: carried.length,
    ...stamps,
  };
}

export interface ResyncAllSummary {
  today: string;
  clientsResynced: number;
  failures: { clientId: number; clientName: string; error: string }[];
}

/**
 * Backfill: give every non-project client a live-state template (the Python
 * `python -m app.resync_all_billing` path that retires clients off the frozen
 * legacy invoice branch). Per-client try/catch (§9): one bad client is
 * logged and skipped, never aborts the batch.
 */
export async function resyncAllBilling(today: LocalDate = localToday()): Promise<ResyncAllSummary> {
  const summary: ResyncAllSummary = {
    today: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
    clientsResynced: 0,
    failures: [],
  };
  const allClients = await db
    .select()
    .from(clients)
    .where(eq(clients.isProjectEngagement, false));
  for (const client of allClients) {
    try {
      await resyncClientBillingFromLiveState(client.id, today);
      summary.clientsResynced += 1;
    } catch (err) {
      console.error(`[billing-sync] client ${client.id} (${client.legalName}) failed:`, err);
      summary.failures.push({
        clientId: client.id,
        clientName: client.legalName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ── Resync triggers (§15) - the seam other workstreams call ──────────────

/** §15 trigger: account create/update/delete. Call after any account write. */
export async function onAccountBillingChanged(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<ResyncResult> {
  return resyncClientBillingFromLiveState(clientId, today);
}

/** §15 trigger: property create/update/delete (mortgages feed the loan count). */
export async function onPropertyBillingChanged(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<ResyncResult> {
  return resyncClientBillingFromLiveState(clientId, today);
}

/**
 * §15 trigger: a billing-relevant client field changed - 1099 flags or
 * estimated count, QBO class/location names, merchant-reconciliation flag,
 * real-estate flag.
 */
export async function onClientBillingFieldsChanged(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<ResyncResult> {
  return resyncClientBillingFromLiveState(clientId, today);
}

/** §15 trigger: bookkeeping/billing frequency or monthly close tier changed. */
export async function onCadenceOrTierChanged(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<ResyncResult> {
  return resyncClientBillingFromLiveState(clientId, today);
}
