import { and, eq } from "drizzle-orm";
import {
  addDays,
  bankFeedDueDate,
  closeTierDueDate,
  compareLocalDate,
  dayOfWeek,
  formatLocalDate,
  generatesRecurringWork,
  parseLocalDate,
  reconciliationDueDate,
  reportMonthsForFrequency,
  statementReleaseDate,
  tierDayForClient,
  workPeriodForDue,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientIntakes,
  clientReports,
  clients,
  weeklyBankFeeds,
} from "@/db/schema";

import { catchupOf, toDomainClient, type ClientRow } from "./domain-adapters";
import { localToday } from "./dates";

/**
 * materializeOperationalRows - HANDOFF §6.3 generation + §9 materialization
 * detail. Creates the three kinds of periodic rows (weekly bank feeds,
 * account reconciliations, client reports) for the current year, plus next
 * year once today.month >= 11.
 *
 * Eligibility comes ONLY from the domain (§30 conv. 2): clients passing
 * generatesRecurringWork (active - paused/inactive/project-only excluded).
 *
 * Idempotent: bank-feed and reconciliation inserts rely on the schema's
 * unique constraints (weekly_bank_feeds(client_id, week_start_date),
 * account_reconciliations(account_id, year, month)) via ON CONFLICT DO
 * NOTHING; client_reports has no unique constraint in the schema, so it is
 * guarded by an existence check on (client, name, period). Running twice
 * changes nothing.
 *
 * Per-client isolation (§9): each client is processed independently inside
 * try/catch; one bad client is logged and skipped, never aborts the batch.
 */

export interface MaterializeClientFailure {
  clientId: number;
  clientName: string;
  error: string;
}

export interface MaterializeSummary {
  today: string;
  years: number[];
  clientsProcessed: number;
  clientsSkipped: number;
  bankFeedsCreated: number;
  reconciliationsCreated: number;
  reportsCreated: number;
  failures: MaterializeClientFailure[];
}

interface ReportDefinition {
  name: string;
  frequency: string;
}

export async function materializeOperationalRows(
  today: LocalDate = localToday(),
): Promise<MaterializeSummary> {
  const years = today.month >= 11 ? [today.year, today.year + 1] : [today.year];
  const summary: MaterializeSummary = {
    today: formatLocalDate(today),
    years,
    clientsProcessed: 0,
    clientsSkipped: 0,
    bankFeedsCreated: 0,
    reconciliationsCreated: 0,
    reportsCreated: 0,
    failures: [],
  };

  const allClients = await db.select().from(clients);
  for (const client of allClients) {
    if (!generatesRecurringWork(toDomainClient(client))) {
      summary.clientsSkipped += 1;
      continue;
    }
    try {
      const created = await materializeClient(client, years);
      summary.clientsProcessed += 1;
      summary.bankFeedsCreated += created.bankFeeds;
      summary.reconciliationsCreated += created.reconciliations;
      summary.reportsCreated += created.reports;
    } catch (err) {
      // §9 - per-client try/catch: one bad client cannot abort the batch.
      console.error(`[materialize] client ${client.id} (${client.legalName}) failed:`, err);
      summary.failures.push({
        clientId: client.id,
        clientName: client.legalName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

async function materializeClient(
  client: ClientRow,
  years: number[],
): Promise<{ bankFeeds: number; reconciliations: number; reports: number }> {
  let bankFeeds = 0;
  let reconciliations = 0;
  let reports = 0;
  for (const year of years) {
    bankFeeds += await ensureBankFeeds(client, year);
    reconciliations += await ensureReconciliations(client, year);
    reports += await ensureClientReports(client, year);
  }
  return { bankFeeds, reconciliations, reports };
}

// ── Weekly bank feeds (§6.3) ─────────────────────────────────────────────

/** Monday of the week containing d (0 = Sunday convention, §6.4). */
function mondayOfWeek(d: LocalDate): LocalDate {
  return addDays(d, -((dayOfWeek(d) + 6) % 7));
}

async function ensureBankFeeds(client: ClientRow, year: number): Promise<number> {
  if (!client.requiresWeeklyBankFeeds) return 0;

  const jan1: LocalDate = { year, month: 1, day: 1 };
  const dec31: LocalDate = { year, month: 12, day: 31 };
  let lower = jan1;
  if (client.bookkeepingStartDate) {
    const start = parseLocalDate(client.bookkeepingStartDate);
    if (compareLocalDate(start, lower) > 0) lower = start;
  }
  if (compareLocalDate(lower, dec31) > 0) return 0;

  const catchup = catchupOf(client);
  const feedDay = client.bankFeedDayOfWeek ?? undefined;
  let created = 0;

  let weekStart = mondayOfWeek(lower);
  while (compareLocalDate(weekStart, dec31) <= 0) {
    const weekEnd = addDays(weekStart, 6);
    if (compareLocalDate(weekEnd, lower) >= 0) {
      // Due = feed day-of-week on/after the week anchor, floored by catch-up
      // (domain bankFeedDueDate). Attribution uses the UN-FLOORED due date:
      // catch-up batches share one floored due date, and deriving from it
      // would collapse them into a single month (§6.1 work_period_for_row).
      const naturalDue = bankFeedDueDate(weekStart, feedDay, null);
      const due = bankFeedDueDate(weekStart, feedDay, catchup);
      const period = workPeriodForDue(naturalDue);
      const inserted = await db
        .insert(weeklyBankFeeds)
        .values({
          clientId: client.id,
          weekStartDate: formatLocalDate(weekStart),
          weekEndDate: formatLocalDate(weekEnd),
          dueDate: formatLocalDate(due),
          attributedYear: period.year,
          attributedMonth: period.month,
        })
        .onConflictDoNothing()
        .returning({ id: weeklyBankFeeds.id });
      created += inserted.length;
    }
    weekStart = addDays(weekStart, 7);
  }
  return created;
}

// ── Account reconciliations (§6.3) ───────────────────────────────────────

async function ensureReconciliations(client: ClientRow, year: number): Promise<number> {
  const clientAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.clientId, client.id), eq(accounts.isActive, true)));

  const tier = tierDayForClient(toDomainClient(client));
  const catchup = catchupOf(client);
  const startMonth = client.bookkeepingStartDate
    ? parseLocalDate(client.bookkeepingStartDate)
    : null;

  let created = 0;
  for (const account of clientAccounts) {
    // Only accounts that have a statement_day enter the reconciliation
    // stream; 0 means end-of-month, null means owner-documented (excluded).
    if (account.statementDay == null) continue;
    const openMonth = account.openDate ? parseLocalDate(account.openDate) : null;
    const closeMonth = account.closeDate ? parseLocalDate(account.closeDate) : null;

    for (let month = 1; month <= 12; month++) {
      if (startMonth && (year < startMonth.year || (year === startMonth.year && month < startMonth.month))) continue;
      if (openMonth && (year < openMonth.year || (year === openMonth.year && month < openMonth.month))) continue;
      if (closeMonth && (year > closeMonth.year || (year === closeMonth.year && month > closeMonth.month))) continue;

      const statementDate = statementReleaseDate(account.statementDay, year, month, tier);
      const due = reconciliationDueDate({ year, month }, statementDate, tier, catchup);
      const inserted = await db
        .insert(accountReconciliations)
        .values({
          accountId: account.id,
          clientId: client.id,
          attributedYear: year,
          attributedMonth: month,
          statementDate: formatLocalDate(statementDate),
          dueDate: formatLocalDate(due),
        })
        .onConflictDoNothing()
        .returning({ id: accountReconciliations.id });
      created += inserted.length;
    }
  }
  return created;
}

// ── Client reports (§6.3) ────────────────────────────────────────────────

/**
 * Report definitions live on the linked intake. The structured
 * report_definitions column wins when populated; otherwise fall back to the
 * wizard payload in form_data (reportDefinitions / report_definitions),
 * which is what the seed and the intake-conversion path write.
 */
export function reportDefinitionsOf(intake: {
  reportDefinitions: unknown;
  formData: unknown;
}): ReportDefinition[] {
  const fromColumn = Array.isArray(intake.reportDefinitions)
    ? (intake.reportDefinitions as ReportDefinition[])
    : [];
  if (fromColumn.length > 0) {
    return fromColumn.filter((d) => d && typeof d.name === "string" && typeof d.frequency === "string");
  }
  const form = (intake.formData ?? null) as Record<string, unknown> | null;
  const fromForm = (form?.reportDefinitions ?? form?.report_definitions) as unknown;
  if (!Array.isArray(fromForm)) return [];
  return (fromForm as ReportDefinition[]).filter(
    (d) => d && typeof d.name === "string" && typeof d.frequency === "string",
  );
}

async function ensureClientReports(client: ClientRow, year: number): Promise<number> {
  const [intake] = await db
    .select()
    .from(clientIntakes)
    .where(eq(clientIntakes.clientId, client.id))
    .limit(1);
  if (!intake) return 0;

  const definitions = reportDefinitionsOf(intake);
  if (definitions.length === 0) return 0;

  // Non-monthly clients have no tier cutoff and fall back to the default
  // 15 (§6.1 RULE 1) - do not use the raw stored tier here.
  const tier = tierDayForClient(toDomainClient(client)) ?? 15;
  const startMonth = client.bookkeepingStartDate
    ? parseLocalDate(client.bookkeepingStartDate)
    : null;

  let created = 0;
  for (const def of definitions) {
    for (const month of reportMonthsForFrequency(def.frequency)) {
      if (startMonth && (year < startMonth.year || (year === startMonth.year && month < startMonth.month))) continue;
      // client_reports has no unique constraint in the schema, so idempotency
      // is an existence check on (client, report name, attributed period).
      const [existing] = await db
        .select({ id: clientReports.id })
        .from(clientReports)
        .where(
          and(
            eq(clientReports.clientId, client.id),
            eq(clientReports.name, def.name),
            eq(clientReports.attributedYear, year),
            eq(clientReports.attributedMonth, month),
          ),
        )
        .limit(1);
      if (existing) continue;

      // Due at the client's promised close (tier day of the following month;
      // default 15 for non-monthly clients, §6.1 RULE 1).
      const due = closeTierDueDate({ year, month }, tier);
      await db.insert(clientReports).values({
        clientId: client.id,
        name: def.name,
        attributedYear: year,
        attributedMonth: month,
        dueDate: formatLocalDate(due),
      });
      created += 1;
    }
  }
  return created;
}
