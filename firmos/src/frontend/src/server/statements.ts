import { and, eq, inArray } from "drizzle-orm";
import {
  addDays,
  addMonths,
  compareLocalDate,
  formatLocalDate,
  isOnHold,
  needsStatements,
  nextUpcomingStatement,
  parseLocalDate,
  statementReleaseDate,
  tierDayForClient,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { db } from "@/db";
import { accounts, clientIntakes, clients, projects } from "@/db/schema";
import { localToday } from "@/server/dates";
import {
  uploadedStatementMonths,
  type AccountRow,
  type ClientRow,
  type DocumentRow,
} from "@/server/documents";
import { toDomainClient } from "@/server/domain-adapters";

/**
 * Statement tracking (HANDOFF §6.7, §14).
 *
 * There is deliberately no mutable "statement downloaded" status column and
 * no mark-downloaded endpoint: uploaded months are derived purely from
 * Document rows with doc_type='statement', so the queue cannot drift from
 * reality by someone ticking a box (§14, verbatim principle).
 *
 * §29 fixes baked in:
 *  - a month counts as missing ONLY once its release date has passed (the
 *    legacy checklist marked months missing before release);
 *  - deferral suppresses overdue without hiding the missing count.
 */

export class StatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementError";
  }
}

// ── statementStatusForAccount (§6.7) ──────────────────────────────────────

export interface StatementAccountInput {
  statementDay: number | null;
  openDate: string | null;
}

export interface StatementClientInput {
  bookkeepingFrequency: string | null;
  /** pgEnum text '5'|'10'|'15' (or number) - coerced to the domain tier. */
  monthlyCloseTier: string | number | null;
  bookkeepingStartDate: string | null;
  /** §6.7 intake fallback: used when the client row has no start date. */
  intakeBookkeepingStartDate?: string | null;
}

export interface StatementStatus {
  /** The accounting month of the next statement to obtain. */
  nextPeriod: Month | null;
  /** Release date of that statement (ISO), or null when fully caught up. */
  nextStatementDate: string | null;
  missingCount: number;
  earliestMissingPeriod: Month | null;
  earliestMissingDate: string | null;
  deferredUntil: string | null;
  isDeferred: boolean;
  isOverdue: boolean;
}

function coerceTier(raw: string | number | null): 5 | 10 | 15 | null {
  const n = raw == null ? null : Number(raw);
  return n === 5 || n === 10 || n === 15 ? n : null;
}

function maxMonth(a: Month, b: Month): Month {
  return compareMonths(a, b) >= 0 ? a : b;
}

/** Ascending (year, month) comparison - never compare Month objects by reference. */
function compareMonths(a: Month, b: Month): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** §6.7 - the later of client start (intake fallback), account open, Jan 1. */
export function requiredStartMonth(
  account: StatementAccountInput,
  client: StatementClientInput,
  today: LocalDate,
): Month {
  let start: Month = { year: today.year, month: 1 };
  const clientStart = client.bookkeepingStartDate ?? client.intakeBookkeepingStartDate ?? null;
  if (clientStart) {
    const d = parseLocalDate(clientStart);
    start = maxMonth(start, { year: d.year, month: d.month });
  }
  if (account.openDate) {
    const d = parseLocalDate(account.openDate);
    start = maxMonth(start, { year: d.year, month: d.month });
  }
  return start;
}

/**
 * §6.7 - THE one function answering "what's next, what's missing, is it
 * overdue". The queue endpoint, the upload response, and the nightly alert
 * all call this; nothing else may re-implement the math.
 *
 * Algorithm: compute the required start (later of client start with intake
 * fallback, account open date, Jan 1 of the current year); walk months
 * forward, counting a month missing only once its release date has passed
 * (§29 fix); with no gaps, the domain nextUpcomingStatement finds the next
 * future release; overdue = next date in the past and not deferred.
 */
export function statementStatusForAccount(
  account: StatementAccountInput,
  client: StatementClientInput,
  uploadedMonths: readonly Month[],
  today: LocalDate,
  deferral: string | null = null,
): StatementStatus {
  const tier = tierDayForClient({
    bookkeeping_frequency: client.bookkeepingFrequency,
    monthly_close_tier: coerceTier(client.monthlyCloseTier),
  });
  const start = requiredStartMonth(account, client, today);
  const have = new Set(uploadedMonths.map((m) => `${m.year}-${m.month}`));

  const missing: { period: Month; releaseDate: LocalDate }[] = [];
  let cursor: Month = start;
  for (let i = 0; i < 240; i++) {
    const release = statementReleaseDate(account.statementDay, cursor.year, cursor.month, tier);
    // Release dates increase with the month, so the first future release
    // ends the missing walk (§29: nothing counts missing before release).
    if (compareLocalDate(release, today) >= 0) break;
    if (!have.has(`${cursor.year}-${cursor.month}`)) {
      missing.push({ period: cursor, releaseDate: release });
    }
    cursor = addMonths(cursor, 1);
  }

  let next: { period: Month; releaseDate: LocalDate } | null = missing[0] ?? null;
  if (!next) {
    const upcoming = nextUpcomingStatement(
      account.statementDay,
      uploadedMonths,
      today,
      tier,
      start,
    );
    if (upcoming) {
      next = {
        period: { year: upcoming.year, month: upcoming.month },
        releaseDate: upcoming.releaseDate,
      };
    }
  }

  // §5 - deferral suppresses overdue; it never erases the missing count.
  const deferredUntil = deferral && compareLocalDate(parseLocalDate(deferral), today) > 0 ? deferral : null;
  const isOverdue =
    next != null && compareLocalDate(next.releaseDate, today) < 0 && deferredUntil == null;

  return {
    nextPeriod: next?.period ?? null,
    nextStatementDate: next ? formatLocalDate(next.releaseDate) : null,
    missingCount: missing.length,
    earliestMissingPeriod: missing[0]?.period ?? null,
    earliestMissingDate: missing[0] ? formatLocalDate(missing[0].releaseDate) : null,
    deferredUntil,
    isDeferred: deferredUntil != null,
    isOverdue,
  };
}

// ── Shared eligibility (§6.7, §14) ────────────────────────────────────────

interface EligibleClient {
  client: ClientRow;
  intakeStart: string | null;
}

/**
 * §6.7 queue gate: the client passes needsStatements and is not on hold.
 * needsStatements takes the has-active-project verdict for project-only
 * clients (domain client_state.py:96 - caller supplies the DB verdict).
 */
async function eligibleStatementClients(): Promise<EligibleClient[]> {
  const [clientRows, intakeRows, activeProjects] = await Promise.all([
    db.select().from(clients),
    db.select().from(clientIntakes),
    db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(inArray(projects.status, ["pending", "in_progress"])),
  ]);
  const intakeStartByClient = new Map(intakeRows.map((i) => [i.clientId, i.bookkeepingStartDate]));
  const clientsWithActiveProject = new Set(activeProjects.map((p) => p.clientId));

  const eligible: EligibleClient[] = [];
  for (const client of clientRows) {
    const domain = toDomainClient(client);
    if (isOnHold(domain)) continue;
    if (!needsStatements(domain, clientsWithActiveProject.has(client.id))) continue;
    eligible.push({
      client,
      intakeStart: client.bookkeepingStartDate
        ? null
        : (intakeStartByClient.get(client.id) ?? null),
    });
  }
  return eligible;
}

function toClientInput(client: ClientRow, intakeStart: string | null): StatementClientInput {
  return {
    bookkeepingFrequency: client.bookkeepingFrequency,
    monthlyCloseTier: client.monthlyCloseTier,
    bookkeepingStartDate: client.bookkeepingStartDate,
    intakeBookkeepingStartDate: intakeStart,
  };
}

// ── Statement download queue (§14) ────────────────────────────────────────

export interface StatementQueueRow {
  accountId: number;
  accountName: string;
  institution: string | null;
  statementDay: number | null;
  clientId: number;
  clientName: string;
  status: StatementStatus;
}

/**
 * §14 - active accounts with a statement_day whose client passes
 * needsStatements and is not on hold. Overdue rows first, then by next date.
 */
export async function getStatementQueue(today: LocalDate = localToday()): Promise<StatementQueueRow[]> {
  const eligible = await eligibleStatementClients();
  if (eligible.length === 0) return [];
  const clientById = new Map(eligible.map((e) => [e.client.id, e] as const));

  const accountRows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.isActive, true),
        inArray(
          accounts.clientId,
          eligible.map((e) => e.client.id),
        ),
      ),
    );
  const statementAccounts = accountRows.filter((a) => a.statementDay != null);
  const uploaded = await uploadedStatementMonths(statementAccounts.map((a) => a.id));

  const rows: StatementQueueRow[] = [];
  for (const account of statementAccounts) {
    const entry = clientById.get(account.clientId)!;
    const months = (uploaded.get(account.id) ?? []).map((u) => u.period);
    const status = statementStatusForAccount(
      account,
      toClientInput(entry.client, entry.intakeStart),
      months,
      today,
      account.statementsDeferredUntil,
    );
    rows.push({
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      statementDay: account.statementDay,
      clientId: entry.client.id,
      clientName: entry.client.dbaName ?? entry.client.legalName,
      status,
    });
  }

  rows.sort((a, b) => {
    if (a.status.isOverdue !== b.status.isOverdue) return a.status.isOverdue ? -1 : 1;
    if (a.status.nextStatementDate && b.status.nextStatementDate) {
      if (a.status.nextStatementDate !== b.status.nextStatementDate) {
        return a.status.nextStatementDate < b.status.nextStatementDate ? -1 : 1;
      }
    } else if (a.status.nextStatementDate) {
      return -1;
    } else if (b.status.nextStatementDate) {
      return 1;
    }
    return a.clientName.localeCompare(b.clientName) || a.accountName.localeCompare(b.accountName);
  });
  return rows;
}

// ── Statements grid (client detail + portal, §14) ─────────────────────────

export type StatementCellState = "uploaded" | "missing" | "deferred" | "future" | "before_start";

export interface StatementGridCell {
  year: number;
  month: number;
  state: StatementCellState;
  /** Release date of the statement covering this accounting month (ISO). */
  releaseDate: string;
  documentId: number | null;
  fileName: string | null;
  /** Ending balance captured at upload (numeric string), or null. */
  endingBalance: string | null;
  /** The date printed on the uploaded statement (ISO), or null. */
  statementDate: string | null;
}

export interface StatementGridAccount {
  accountId: number;
  accountName: string;
  statementDay: number;
  deferredUntil: string | null;
  closeDate: string | null;
  cells: StatementGridCell[];
}

export interface StatementsGrid {
  clientId: number;
  today: string;
  accounts: StatementGridAccount[];
}

/**
 * §14 - per-account by-month grid. Cells derive from Document rows (stored
 * attributed period preferred); a month is missing only once its release
 * date has passed (§29 fix); deferred and before-start are explicit states.
 */
export async function getStatementsGrid(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<StatementsGrid> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new StatementError("That client no longer exists.");

  const [intake] = await db
    .select()
    .from(clientIntakes)
    .where(eq(clientIntakes.clientId, clientId))
    .limit(1);
  const clientInput = toClientInput(
    client,
    client.bookkeepingStartDate ? null : (intake?.bookkeepingStartDate ?? null),
  );
  const tier = tierDayForClient({
    bookkeeping_frequency: client.bookkeepingFrequency,
    monthly_close_tier: coerceTier(client.monthlyCloseTier),
  });

  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), eq(accounts.isActive, true)));
  const statementAccounts = accountRows.filter((a) => a.statementDay != null);
  const uploaded = await uploadedStatementMonths(statementAccounts.map((a) => a.id));

  // Grid starts at the later of Jan 1 this year and the client's start, so
  // before-start cells can only come from the account's own open date.
  const gridStart = requiredStartMonth({ statementDay: 31, openDate: null }, clientInput, today);
  const gridEnd: Month = { year: today.year, month: today.month };

  const result: StatementGridAccount[] = [];
  for (const account of statementAccounts) {
    const accountStart = requiredStartMonth(account, clientInput, today);
    const closeMonth = account.closeDate
      ? (() => {
          const d = parseLocalDate(account.closeDate!);
          return { year: d.year, month: d.month } as Month;
        })()
      : null;
    const end = closeMonth && compareMonths(closeMonth, gridEnd) < 0 ? closeMonth : gridEnd;

    const byPeriod = new Map<string, DocumentRow>();
    for (const u of uploaded.get(account.id) ?? []) {
      byPeriod.set(`${u.period.year}-${u.period.month}`, u.document);
    }

    const deferralDate = account.statementsDeferredUntil
      ? parseLocalDate(account.statementsDeferredUntil)
      : null;

    const cells: StatementGridCell[] = [];
    let cursor: Month = gridStart;
    while (compareMonths(cursor, end) <= 0) {
      const release = statementReleaseDate(account.statementDay, cursor.year, cursor.month, tier);
      const doc = byPeriod.get(`${cursor.year}-${cursor.month}`) ?? null;
      let state: StatementCellState;
      if (doc) {
        state = "uploaded";
      } else if (compareMonths(cursor, accountStart) < 0) {
        state = "before_start";
      } else if (compareLocalDate(release, today) >= 0) {
        state = "future";
      } else if (deferralDate && compareLocalDate(release, deferralDate) <= 0) {
        state = "deferred";
      } else {
        state = "missing";
      }
      cells.push({
        year: cursor.year,
        month: cursor.month,
        state,
        releaseDate: formatLocalDate(release),
        documentId: doc?.id ?? null,
        fileName: doc?.fileName ?? null,
        endingBalance: doc?.endingBalance ?? null,
        statementDate: doc?.statementDate ?? null,
      });
      cursor = addMonths(cursor, 1);
    }

    result.push({
      accountId: account.id,
      accountName: account.name,
      statementDay: account.statementDay!,
      deferredUntil: account.statementsDeferredUntil,
      closeDate: account.closeDate,
      cells,
    });
  }

  return { clientId, today: formatLocalDate(today), accounts: result };
}

// ── Deferral + manual transactions (§5, §14) ──────────────────────────────

/**
 * §6.7 - the upload-response read: fresh status for one account after a
 * statement upload or promotion.
 */
export async function getAccountStatementStatus(
  accountId: number,
  today: LocalDate = localToday(),
): Promise<StatementStatus> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new StatementError("That account no longer exists.");
  const [client] = await db.select().from(clients).where(eq(clients.id, account.clientId)).limit(1);
  if (!client) throw new StatementError("That client no longer exists.");
  const uploaded = await uploadedStatementMonths([account.id]);
  const months = (uploaded.get(account.id) ?? []).map((u) => u.period);
  return statementStatusForAccount(
    account,
    toClientInput(client, null),
    months,
    today,
    account.statementsDeferredUntil,
  );
}

/** §5 - park an account's statements out to a date; null clears the deferral. */
export async function deferAccountStatements(
  accountId: number,
  until: string | null,
): Promise<AccountRow> {
  if (until != null) {
    try {
      parseLocalDate(until);
    } catch {
      throw new StatementError("The deferral date must be a valid date (YYYY-MM-DD).");
    }
  }
  const [row] = await db
    .update(accounts)
    .set({ statementsDeferredUntil: until })
    .where(eq(accounts.id, accountId))
    .returning();
  if (!row) throw new StatementError("That account no longer exists.");
  return row;
}

export interface TransactionDownloadQueueRow {
  accountId: number;
  accountName: string;
  institution: string | null;
  clientId: number;
  clientName: string;
  lastTransactionsDownloadedAt: string | null;
  /** Next date a download is expected (ISO). */
  nextDueDate: string;
  isDue: boolean;
}

/**
 * §14 - accounts flagged requires_manual_transactions, clients not on hold.
 * The handoff specifies no cadence for the next-date calculation beyond
 * "its own": a fresh download is expected the day after the last one, and
 * accounts never downloaded are due today.
 */
export async function getTransactionDownloadQueue(
  today: LocalDate = localToday(),
): Promise<TransactionDownloadQueueRow[]> {
  const eligible = await eligibleStatementClients();
  if (eligible.length === 0) return [];
  const clientById = new Map(eligible.map((e) => [e.client.id, e.client] as const));

  const accountRows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.isActive, true),
        eq(accounts.requiresManualTransactions, true),
        inArray(
          accounts.clientId,
          eligible.map((e) => e.client.id),
        ),
      ),
    );

  const rows: TransactionDownloadQueueRow[] = accountRows.map((account) => {
    const client = clientById.get(account.clientId)!;
    const nextDue = account.lastTransactionsDownloadedAt
      ? formatLocalDate(addDays(parseLocalDate(account.lastTransactionsDownloadedAt), 1))
      : formatLocalDate(today);
    return {
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      clientId: client.id,
      clientName: client.dbaName ?? client.legalName,
      lastTransactionsDownloadedAt: account.lastTransactionsDownloadedAt,
      nextDueDate: nextDue,
      isDue: compareLocalDate(parseLocalDate(nextDue), today) <= 0,
    };
  });
  rows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.clientName.localeCompare(b.clientName));
  return rows;
}

/** §14 - the mark-transactions-downloaded endpoint's engine half. */
export async function markTransactionsDownloaded(
  accountId: number,
  date: string,
): Promise<AccountRow> {
  try {
    parseLocalDate(date);
  } catch {
    throw new StatementError("The download date must be a valid date (YYYY-MM-DD).");
  }
  const [row] = await db
    .update(accounts)
    .set({ lastTransactionsDownloadedAt: date })
    .where(eq(accounts.id, accountId))
    .returning();
  if (!row) throw new StatementError("That account no longer exists.");
  return row;
}
