import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  addDays,
  addMonths,
  billingCycleMonths,
  customItemQuantity,
  diffMonths,
  februaryBilledDue,
  formatLocalDate,
  generatesRecurringWork,
  isFebruaryBilledService,
  isReconciliationBillableAccount,
  lastDayOfMonth,
  parseLocalDate,
  recurringBillingQuantityForMonth,
  renormalizeTemplateQuantity,
  type LocalDate,
  type Month,
  type RecurringRuleShape,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accounts,
  clients,
  invoiceLineItems,
  invoices,
  recurringTasks,
  tasks,
  users,
} from "@/db/schema";

import { SECTION_DISCOUNT_KEY } from "./billing-sync";
import { localToday } from "./dates";
import { toDomainClient, type ClientRow } from "./domain-adapters";
import { getPricingOverrides } from "./pricing-config";
import type { TemplateLineItem } from "./quote";

/**
 * Invoicing (HANDOFF §6.5 monthly generation, §15 routes_invoices.py).
 *
 * The template path is authoritative when a template is present
 * (client.recurring_services_template); template-less clients with a
 * monthly_recurring_amount fall through to the FROZEN legacy compatibility
 * branch (§30 convention 7: no new business rules there - retire a client
 * off it with resyncAllBilling).
 *
 * Quantities are recomputed from LIVE data at invoice time (§15
 * _build_itemized_line_items): the reconciliation count is a live query of
 * active statement-day accounts excluding loans and merchants (domain
 * predicate - never re-derived here), class/location tracking counts come
 * from the client's current QBO name lists, monthly template items are
 * renormalized quantity / intake_cycle x billing_cycle (§6.5 - the two
 * frequencies are not the same thing), anchored weekly/daily/quarterly/
 * semi-annual/annual items are summed across the months the invoice covers,
 * and 1099 services bill only in February of years after the anchor year
 * (domain februaryBilledDue). Discounts aggregate into a single negative
 * "Preferred Customer Discount" line.
 */

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

export type InvoiceLineType = "recurring" | "task" | "quickbooks_subscription" | "other";

/** One computed invoice line, before persistence. */
export interface InvoiceLineSpec {
  lineType: InvoiceLineType;
  serviceKey: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  amount: number;
  taskId?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** QBO export cap (§15: the CSV is capped at 1000 rows). */
export const QBO_CSV_ROW_CAP = 1000;

// ── Itemized line items (§15) ─────────────────────────────────────────────

/** The months one invoice covers: billing_cycle months starting at (year, month). */
export function coveredMonths(year: number, month: number, billingCycle: number): Month[] {
  const start: Month = { year, month };
  return Array.from({ length: billingCycle }, (_, i) => addMonths(start, i));
}

function scheduleOf(line: TemplateLineItem): RecurringRuleShape | null {
  const days = (line.days_of_week as string | null | undefined) ?? null;
  const weekday = (line.weekday as number | null | undefined) ?? null;
  const weekOfMonth = (line.week_of_month as number | null | undefined) ?? null;
  const dayOfMonth = (line.day_of_month as number | null | undefined) ?? null;
  const anchorMonth = (line.anchor_month as number | null | undefined) ?? null;
  if (!days && weekday == null && weekOfMonth == null && dayOfMonth == null && anchorMonth == null) {
    return null;
  }
  return {
    schedule_type: line.frequency,
    days_of_week: days,
    day_of_month: dayOfMonth,
    weekday,
    week_of_month: weekOfMonth,
    anchor_month: anchorMonth,
    next_run: null, // replaced per covered month below
  };
}

function baseQuantityOf(line: TemplateLineItem): number {
  const base = line.base_quantity;
  return typeof base === "number" && Number.isFinite(base) && base > 0 ? base : 1;
}

/** Occurrences of an anchored/weekly/daily line across the covered months (§15). */
function occurrenceQuantity(line: TemplateLineItem, covered: Month[]): number {
  const shape = scheduleOf(line);
  const base = baseQuantityOf(line);
  if (!shape) {
    // No schedule fields: fall back to the domain's per-month scaling for the
    // item's own frequency, summed over the covered months.
    if (line.frequency === "weekly" || line.frequency === "daily") {
      return covered.reduce(
        (sum) => sum + customItemQuantity(line.frequency as "weekly" | "daily", 1, base),
        0,
      );
    }
    return -1; // caller handles the unanchored periodic spread
  }
  return covered.reduce(
    (sum, m) =>
      sum +
      recurringBillingQuantityForMonth(
        { ...shape, next_run: formatLocalDate({ year: m.year, month: m.month, day: 1 }) },
        m.year,
        m.month,
      ) *
        base,
    0,
  );
}

/** Months per occurrence for an unanchored periodic frequency. */
const PERIOD_SPREAD_MONTHS: Record<string, number> = {
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

export async function buildItemizedLineItems(
  client: ClientRow,
  year: number,
  month: number,
  // §30 conv. 4 entry-point convention; live-state queries are as-of-now.
  _today: LocalDate = localToday(),
): Promise<InvoiceLineSpec[]> {
  void _today;
  const template = Array.isArray(client.recurringServicesTemplate)
    ? (client.recurringServicesTemplate as TemplateLineItem[])
    : [];
  if (template.length === 0) return [];

  const intakeCycle = billingCycleMonths(client.bookkeepingFrequency);
  const billingCycle = billingCycleMonths(client.billingFrequency);
  const covered = coveredMonths(year, month, billingCycle);
  const anchorYear = client.bookkeepingStartDate
    ? parseLocalDate(client.bookkeepingStartDate).year
    : year;

  // Admin pricing overrides (owner call notes): they reprice non-manual
  // template lines at invoice time, so a rate change bills on the next
  // invoice without waiting for a billing resync.
  const pricingOverrides = await getPricingOverrides();

  // §15: the reconciliation count is a LIVE query of active accounts with a
  // statement day, excluding merchant and loan types (domain predicate).
  const liveAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.clientId, client.id), eq(accounts.isActive, true)));
  const reconCount = liveAccounts.filter((a) =>
    isReconciliationBillableAccount({
      account_type: a.accountType,
      is_active: a.isActive,
      statement_day: a.statementDay,
    }),
  ).length;
  const classCount = ((client.qboClassNames as string[] | null) ?? []).length;
  const locationCount = ((client.qboLocationNames as string[] | null) ?? []).length;

  const lines: InvoiceLineSpec[] = [];
  let discountTotal = 0;

  for (const line of template) {
    if (!line || typeof line.service_key !== "string") continue;
    if (line.frequency === "one_time") continue; // one-time services never recur

    // Section discounts aggregate into the single negative line (§15).
    if (line.service_key === SECTION_DISCOUNT_KEY) {
      const qty = renormalizeTemplateQuantity(line.quantity, intakeCycle, billingCycle);
      discountTotal += (line.unit_price ?? 0) * qty;
      continue;
    }

    // §6.5: 1099 services bill only in February of years after the anchor year.
    const febBilled = isFebruaryBilledService(line.service_key);
    if (febBilled && !februaryBilledDue(line.service_key, { year, month }, anchorYear)) {
      continue;
    }

    let quantity: number;
    switch (line.service_key) {
      case "account_reconciliations":
        // §15: live count x billing cycle (per-account pricing).
        quantity = reconCount * billingCycle;
        break;
      case "class_tracking":
        quantity = classCount * billingCycle;
        break;
      case "location_tracking":
        quantity = locationCount * billingCycle;
        break;
      default:
        if (line.frequency === "weekly" || line.frequency === "daily") {
          quantity = occurrenceQuantity(line, covered);
        } else if (
          line.frequency === "quarterly" ||
          line.frequency === "semi_annual" ||
          line.frequency === "annual"
        ) {
          if (febBilled) {
            quantity = line.quantity; // February-billed: fixed annual quantity
          } else if ((line.anchor_month as number | null | undefined) != null) {
            quantity = occurrenceQuantity(line, covered); // anchored: sum covered months
          } else {
            // Unanchored periodic services spread across their natural cycle,
            // matching the effective-monthly formula (§15).
            quantity =
              (line.quantity * billingCycle) / (PERIOD_SPREAD_MONTHS[line.frequency] ?? 1);
          }
        } else {
          // §6.5: monthly template items renormalize qty / intake_cycle x billing_cycle.
          quantity = renormalizeTemplateQuantity(line.quantity, intakeCycle, billingCycle);
        }
    }

    if (quantity <= 0) continue;

    // Price resolution: a manual_edit line is a client-specific contract and
    // keeps its stored price; every other line bills at the admin override
    // when one exists, else its stored template price (identical to before
    // when no overrides are configured). An override can also price a line
    // the template carries unpriced (§15 states no amount for it).
    const unitPrice =
      line.manual_edit === true
        ? line.unit_price
        : (pricingOverrides[line.service_key] ?? line.unit_price);
    if (unitPrice == null) continue; // unpriced - billed manually

    // A per-line discount scales with the same factor its quantity did.
    const perLineDiscount = Number(line.discount ?? 0);
    if (perLineDiscount > 0) {
      const factor = line.quantity > 0 ? quantity / line.quantity : 1;
      discountTotal -= perLineDiscount * factor;
    }

    const amount = round2(unitPrice * quantity);
    lines.push({
      lineType: line.service_key.startsWith("quickbooks_")
        ? "quickbooks_subscription"
        : "recurring",
      serviceKey: line.service_key,
      description: line.product_name,
      quantity: round2(quantity),
      unitPrice,
      discount: perLineDiscount,
      amount,
    });
  }

  if (discountTotal !== 0) {
    const total = round2(discountTotal);
    lines.push({
      lineType: "other",
      serviceKey: SECTION_DISCOUNT_KEY,
      description: "Preferred Customer Discount",
      quantity: 1,
      unitPrice: total,
      discount: 0,
      amount: total,
    });
  }

  return lines;
}

// ── Pending billable tasks (§6.5) ─────────────────────────────────────────

export interface PendingBillableTask {
  taskId: number;
  clientId: number;
  clientName: string;
  title: string;
  completedAt: Date | null;
  attributedYear: number | null;
  attributedMonth: number | null;
  /** From the originating recurring rule; null when ad-hoc (SCHEMA GAP:
   *  tasks has no unit_price column, so ad-hoc billable tasks invoice at
   *  0.00 until staff edits the draft line). */
  unitPrice: string | null;
}

/** Completed billable tasks not yet on any invoice (the pending queue, §15). */
export async function getPendingBillableTasks(clientId?: number): Promise<PendingBillableTask[]> {
  const conditions = [
    eq(tasks.status, "completed"),
    eq(tasks.billableStatus, "billable"),
    isNull(tasks.invoicedAt),
    isNull(tasks.deletedAt),
  ];
  if (clientId != null) conditions.push(eq(tasks.clientId, clientId));
  const rows = await db
    .select({
      taskId: tasks.id,
      clientId: tasks.clientId,
      clientName: clients.legalName,
      title: tasks.title,
      completedAt: tasks.completedAt,
      attributedYear: tasks.attributedYear,
      attributedMonth: tasks.attributedMonth,
      unitPrice: recurringTasks.unitPrice,
    })
    .from(tasks)
    .innerJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(recurringTasks, eq(tasks.recurringTaskId, recurringTasks.id))
    .where(and(...conditions))
    .orderBy(asc(tasks.id));
  return rows
    .filter((r) => r.clientId != null)
    .map((r) => ({ ...r, clientId: r.clientId as number }));
}

async function pendingBillableTasksFor(clientId: number): Promise<PendingBillableTask[]> {
  return getPendingBillableTasks(clientId);
}

// ── Monthly generation (§6.5) ─────────────────────────────────────────────

export interface GenerateFailure {
  clientId: number;
  clientName: string;
  error: string;
}

export interface GenerateSummary {
  year: number;
  month: number;
  invoicesCreated: number;
  skippedExisting: number;
  skippedCadence: number;
  skippedIneligible: number;
  skippedNoBilling: number;
  /** Invoices that would have ended up with no line items (§6.5: deleted
   *  rather than left empty - they are never persisted). */
  emptySkipped: number;
  tasksAttached: number;
  failures: GenerateFailure[];
}

/** Net 15 from the 1st of the target month (§6.5). */
export function net15DueDate(year: number, month: number): string {
  return formatLocalDate(addDays({ year, month, day: 1 }, 15));
}

export async function generateMonthlyInvoices(
  year: number,
  month: number,
  today: LocalDate = localToday(),
): Promise<GenerateSummary> {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvoiceError(`invalid month: ${month}`);
  }
  const summary: GenerateSummary = {
    year,
    month,
    invoicesCreated: 0,
    skippedExisting: 0,
    skippedCadence: 0,
    skippedIneligible: 0,
    skippedNoBilling: 0,
    emptySkipped: 0,
    tasksAttached: 0,
    failures: [],
  };

  const allClients = await db.select().from(clients);
  for (const client of allClients) {
    // §6.2 worked-clients predicate via the domain (§30 conv. 2): paused,
    // inactive, and project-only clients never invoice here.
    if (!generatesRecurringWork(toDomainClient(client))) {
      summary.skippedIneligible += 1;
      continue;
    }
    try {
      const result = await generateForClient(client, year, month, today);
      if (result === "exists") summary.skippedExisting += 1;
      else if (result === "cadence") summary.skippedCadence += 1;
      else if (result === "no_billing") summary.skippedNoBilling += 1;
      else if (result === "empty") summary.emptySkipped += 1;
      else {
        summary.invoicesCreated += 1;
        summary.tasksAttached += result.tasksAttached;
      }
    } catch (err) {
      // §9 - per-client try/catch: one bad client cannot abort the batch.
      console.error(`[invoices] client ${client.id} (${client.legalName}) failed:`, err);
      summary.failures.push({
        clientId: client.id,
        clientName: client.legalName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

type GenerateOutcome =
  | "exists"
  | "cadence"
  | "no_billing"
  | "empty"
  | { tasksAttached: number };

async function generateForClient(
  client: ClientRow,
  year: number,
  month: number,
  today: LocalDate,
): Promise<GenerateOutcome> {
  const billingCycle = billingCycleMonths(client.billingFrequency);

  // §6.5: non-monthly billing cadences invoice only in their cycle month,
  // anchored on the bookkeeping start month (January when no start date).
  const anchor: Month = client.bookkeepingStartDate
    ? parseLocalDate(client.bookkeepingStartDate)
    : { year, month: 1 };
  const diff = diffMonths(anchor, { year, month });
  if (diff < 0 || diff % billingCycle !== 0) return "cadence";

  const hasTemplate =
    Array.isArray(client.recurringServicesTemplate) &&
    (client.recurringServicesTemplate as unknown[]).length > 0;
  const [billableRule] = await db
    .select({ id: recurringTasks.id })
    .from(recurringTasks)
    .where(
      and(
        eq(recurringTasks.clientId, client.id),
        eq(recurringTasks.isActive, true),
        eq(recurringTasks.isBillable, true),
      ),
    )
    .limit(1);
  if (!hasTemplate && client.monthlyRecurringAmount == null && !billableRule) {
    return "no_billing";
  }

  // §6.5: skip clients that already have an invoice for the period. The DB
  // partial unique on (client, year, month) for generated rows is the race
  // guard; this check is the fast path.
  const [existing] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, client.id),
        eq(invoices.year, year),
        eq(invoices.month, month),
        eq(invoices.isAutoGenerated, true),
      ),
    )
    .limit(1);
  if (existing) return "exists";

  const lines: InvoiceLineSpec[] = hasTemplate
    ? await buildItemizedLineItems(client, year, month, today)
    : [];
  if (!hasTemplate && client.monthlyRecurringAmount != null) {
    // FROZEN legacy compatibility branch (§6.5, §30 conv. 7): bill the flat
    // monthly_recurring_amount once per covered month. NO new business rules
    // here - retire a client off this branch by giving it a template via
    // resyncAllBilling().
    const monthly = Number(client.monthlyRecurringAmount);
    lines.push({
      lineType: "recurring",
      serviceKey: null,
      description: "Monthly Bookkeeping Services",
      quantity: billingCycle,
      unitPrice: monthly,
      discount: 0,
      amount: round2(monthly * billingCycle),
    });
  }

  // §6.5: add completed billable tasks that have not been invoiced yet.
  const pending = await pendingBillableTasksFor(client.id);
  for (const task of pending) {
    const price = task.unitPrice == null ? 0 : Number(task.unitPrice);
    lines.push({
      lineType: "task",
      serviceKey: null,
      description: task.title,
      quantity: 1,
      unitPrice: price,
      discount: 0,
      amount: round2(price),
      taskId: task.taskId,
    });
  }

  // §6.5: invoices that end up with no line items are deleted rather than
  // left empty - they are simply never persisted.
  if (lines.length === 0) return "empty";

  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const [inserted] = await db
    .insert(invoices)
    .values({
      clientId: client.id,
      invoiceNumber: `INV-${year}${String(month).padStart(2, "0")}-${client.id}`,
      status: "draft",
      year,
      month,
      isAutoGenerated: true,
      issueDate: formatLocalDate({ year, month, day: 1 }),
      dueDate: net15DueDate(year, month),
      total: total.toFixed(2),
    })
    .onConflictDoNothing()
    .returning({ id: invoices.id });
  if (!inserted) return "exists"; // lost the race to the partial unique index

  await db.insert(invoiceLineItems).values(
    lines.map((l, position) => ({
      invoiceId: inserted.id,
      lineType: l.lineType,
      serviceKey: l.serviceKey,
      description: l.description,
      quantity: l.quantity.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      discount: l.discount.toFixed(2),
      amount: l.amount.toFixed(2),
      taskId: l.taskId ?? null,
      position,
    })),
  );

  // §6.5: completed billable tasks are invoiced once, then stamped.
  const taskIds = lines.map((l) => l.taskId).filter((id): id is number => id != null);
  if (taskIds.length > 0) {
    await db
      .update(tasks)
      .set({ invoicedAt: new Date(), updatedAt: new Date() })
      .where(inArray(tasks.id, taskIds));
  }

  return { tasksAttached: taskIds.length };
}

// ── Lifecycle (§7: draft / sent / paid / overdue / void) ──────────────────

export type InvoiceRow = typeof invoices.$inferSelect;

async function invoiceOrThrow(invoiceId: number): Promise<InvoiceRow> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) throw new InvoiceError(`invoice not found: ${invoiceId}`);
  return invoice;
}

/** draft -> sent, stamping sent_at (§15 send endpoint). */
export async function sendInvoice(invoiceId: number): Promise<InvoiceRow> {
  const invoice = await invoiceOrThrow(invoiceId);
  if (invoice.status !== "draft") {
    throw new InvoiceError(`only a draft invoice can be sent (status: ${invoice.status})`);
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return updated;
}

/** sent/overdue -> paid, stamping paid_at (an overdue invoice is still payable). */
export async function markInvoicePaid(invoiceId: number): Promise<InvoiceRow> {
  const invoice = await invoiceOrThrow(invoiceId);
  if (invoice.status !== "sent" && invoice.status !== "overdue") {
    throw new InvoiceError(
      `only a sent or overdue invoice can be marked paid (status: ${invoice.status})`,
    );
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return updated;
}

/** draft/sent/overdue -> void. Paid invoices are terminal. */
export async function voidInvoice(invoiceId: number): Promise<InvoiceRow> {
  const invoice = await invoiceOrThrow(invoiceId);
  if (invoice.status === "paid" || invoice.status === "void") {
    throw new InvoiceError(`a ${invoice.status} invoice cannot be voided`);
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return updated;
}

export interface MarkOverdueSummary {
  today: string;
  updated: number;
  invoiceIds: number[];
}

/** Job-style helper: sent invoices past their due date become overdue. */
export async function markOverdueInvoices(
  today: LocalDate = localToday(),
): Promise<MarkOverdueSummary> {
  const todayStr = formatLocalDate(today);
  const updated = await db
    .update(invoices)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(and(eq(invoices.status, "sent"), sql`${invoices.dueDate} < ${todayStr}`))
    .returning({ id: invoices.id });
  return { today: todayStr, updated: updated.length, invoiceIds: updated.map((r) => r.id) };
}

// ── QuickBooks CSV export (§15) ───────────────────────────────────────────

/** mm/dd/yyyy, parsed from an ISO-local date string (never `new Date`, §30 conv. 4). */
function qboDate(iso: string | null): string {
  if (!iso) return "";
  const d = parseLocalDate(iso);
  return `${String(d.month).padStart(2, "0")}/${String(d.day).padStart(2, "0")}/${d.year}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const QBO_CSV_HEADER =
  "Invoice No,Customer,Invoice Date,Due Date,Item,Description,Qty,Rate,Amount";

/**
 * The QBO export (§15): the columns QuickBooks expects, dates mm/dd/yyyy,
 * capped at QBO_CSV_ROW_CAP data rows.
 */
export async function quickbooksCsv(invoiceIds: number[]): Promise<string> {
  if (invoiceIds.length === 0) return `${QBO_CSV_HEADER}\n`;
  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      customer: clients.legalName,
      lineType: invoiceLineItems.lineType,
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitPrice: invoiceLineItems.unitPrice,
      amount: invoiceLineItems.amount,
      position: invoiceLineItems.position,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .innerJoin(invoiceLineItems, eq(invoiceLineItems.invoiceId, invoices.id))
    .where(inArray(invoices.id, invoiceIds))
    .orderBy(asc(invoices.id), asc(invoiceLineItems.position));

  const lines = [QBO_CSV_HEADER];
  for (const row of rows.slice(0, QBO_CSV_ROW_CAP)) {
    // QBO's Item column expects the product/service name; our recurring
    // descriptions ARE the product names, task lines export as Billable Task.
    const item = row.lineType === "task" ? "Billable Task" : row.description;
    lines.push(
      [
        row.invoiceNumber ?? `INV-${row.invoiceId}`,
        row.customer,
        qboDate(row.issueDate),
        qboDate(row.dueDate),
        item,
        row.description,
        String(Number(row.quantity)),
        Number(row.unitPrice).toFixed(2),
        Number(row.amount).toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

// ── By-employee billing report (§15) ──────────────────────────────────────

export interface EmployeeBillingRow {
  bookkeeperId: number | null;
  bookkeeperName: string;
  invoiceCount: number;
  total: string;
}

/**
 * §15 by-employee billing report: invoiced totals grouped by the client's
 * bookkeeper, over invoices sent or paid in the month (the commission
 * population, §15 payroll).
 */
export async function byEmployeeBillingReport(
  year: number,
  month: number,
): Promise<EmployeeBillingRow[]> {
  const first = formatLocalDate({ year, month, day: 1 });
  const last = formatLocalDate({ year, month, day: lastDayOfMonth(year, month) });
  const rows = await db
    .select({
      invoiceId: invoices.id,
      total: invoices.total,
      bookkeeperId: clients.bookkeeperId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(users, eq(clients.bookkeeperId, users.id))
    .where(
      and(
        inArray(invoices.status, ["sent", "paid", "overdue"]),
        sql`(${invoices.sentAt}::date between ${first} and ${last}) or (${invoices.paidAt}::date between ${first} and ${last})`,
      ),
    );

  const grouped = new Map<number | null, { name: string; count: number; total: number }>();
  for (const row of rows) {
    const key = row.bookkeeperId;
    const entry = grouped.get(key) ?? {
      name: key == null ? "Unassigned" : `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
      count: 0,
      total: 0,
    };
    entry.count += 1;
    entry.total += Number(row.total ?? 0);
    grouped.set(key, entry);
  }
  return [...grouped.entries()]
    .map(([bookkeeperId, entry]) => ({
      bookkeeperId,
      bookkeeperName: entry.name,
      invoiceCount: entry.count,
      total: round2(entry.total).toFixed(2),
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));
}
