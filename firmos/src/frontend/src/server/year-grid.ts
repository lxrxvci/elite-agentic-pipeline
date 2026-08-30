import { and, eq, isNull, notInArray } from "drizzle-orm";
import {
  clientWorkState,
  compareLocalDate,
  diffMonths,
  effectiveDueDate,
  formatLocalDate,
  isOnHold,
  isSettled,
  parseLocalDate,
  reportMonthsForFrequency,
  workPeriodForDue,
  workPeriodForRow,
  type ClientWorkState,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";

import { requireStaff } from "./auth/guards";
import { toDomainClient } from "./domain-adapters";
import { localToday } from "./dates";

/**
 * getClientYearGrid - the per-client year progress grid: one row per work
 * stream (bank feeds, reconciliations, reports, tasks), one column per
 * cadence period (12 for monthly, 4 quarterly, 2 semi-annual, 1 annual).
 *
 * Every rule comes from @firmos/domain so a cell can never disagree with the
 * unified queue (§30 conv. 1-2):
 *  - Period attribution reuses workPeriodForRow / the queue's taskPeriod
 *    fallback (stored period wins, then due-date derivation, then the
 *    current work period for due-less ad-hoc tasks).
 *  - Settled means the domain isSettled: complete OR waiting on client.
 *  - Overdue means past the domain effectiveDueDate (deferred_until applied;
 *    the catch-up floor is already baked into stored due dates at
 *    generation, §32).
 *  - Columns are the domain reportMonthsForFrequency cadence months; rows
 *    attributed to an off-cadence month roll up into the column that closes
 *    their period (a quarterly client's February reconciliation lands in the
 *    March column).
 *  - On-hold clients (paused/inactive, §6.2) are never scored: every cell
 *    reads not_due and the grid carries a header note.
 */

export type YearGridStream = "bank_feeds" | "reconciliations" | "reports" | "tasks";

export const YEAR_GRID_STREAMS: YearGridStream[] = [
  "bank_feeds",
  "reconciliations",
  "reports",
  "tasks",
];

export type YearGridCellState =
  | "complete"
  | "in_progress"
  | "behind"
  | "waiting"
  | "not_due"
  | "no_work";

export interface YearGridCell {
  stream: YearGridStream;
  /** Column period (the cadence month that closes it, e.g. 3 for Q1). */
  year: number;
  month: number;
  /** Source calendar months this column aggregates ([3] or [1,2,3]). */
  months: number[];
  state: YearGridCellState;
  total: number;
  /** completed_at set (tasks: status completed). */
  completed: number;
  /** Open but parked on the client (subset of not-completed). */
  waiting: number;
  /** Neither completed nor waiting - the actionable remainder. */
  open: number;
  /** Of the actionable rows, how many are past their effective due date. */
  overdue: number;
}

export interface YearGridRow {
  stream: YearGridStream;
  cells: YearGridCell[];
}

export interface ClientYearGrid {
  clientId: number;
  year: number;
  /** Firm-local today, ISO-local. */
  today: string;
  state: ClientWorkState;
  frequency: string;
  onHold: boolean;
  /** Header note for on-hold clients; null otherwise. */
  note: string | null;
  columns: Month[];
  rows: YearGridRow[];
}

/** Normalized row the cell-state machine scores. */
export interface GridWorkRow {
  period: Month;
  completed: boolean;
  waiting: boolean;
  dueDate: string | null;
  deferredUntil: string | null;
}

/**
 * The column that owns an attributed month: the first cadence month at/after
 * it (Feb lands in Mar for quarterly). Every calendar month maps because the
 * cadence list always ends at 12.
 */
export function columnMonthFor(attributedMonth: number, cadenceMonths: number[]): number {
  for (const m of cadenceMonths) {
    if (attributedMonth <= m) return m;
  }
  return cadenceMonths[cadenceMonths.length - 1];
}

/** The source months a column aggregates (Q1 -> [1,2,3]; monthly -> [m]). */
export function coveredMonths(columnIndex: number, cadenceMonths: number[]): number[] {
  const end = cadenceMonths[columnIndex];
  const start = columnIndex === 0 ? 1 : cadenceMonths[columnIndex - 1] + 1;
  const months: number[] = [];
  for (let m = start; m <= end; m++) months.push(m);
  return months;
}

/** Queue parity (queue.ts place()): overdue means strictly before today. */
function isPastEffectiveDue(row: GridWorkRow, today: LocalDate): boolean {
  if (!row.dueDate) return false;
  const effective = effectiveDueDate(parseLocalDate(row.dueDate), {
    deferredUntil: row.deferredUntil ? parseLocalDate(row.deferredUntil) : null,
  });
  return compareLocalDate(effective, today) < 0;
}

function isFuturePeriod(period: Month, today: LocalDate): boolean {
  return diffMonths({ year: today.year, month: today.month }, period) > 0;
}

/**
 * Cell state, in precedence order:
 *  1. no rows                                  -> no_work
 *  2. nothing actionable left                  -> complete when at least one
 *     row is actually done, waiting when every row is parked on the client
 *     (isSettled: done-or-waiting rows never block a period)
 *  3. any actionable row past effective due    -> behind
 *  4. some progress (done or waiting)          -> in_progress
 *  5. period has not started                   -> not_due
 *  6. open work, nothing overdue yet           -> in_progress
 */
export function scoreCell(rows: GridWorkRow[], period: Month, today: LocalDate): YearGridCellState {
  if (rows.length === 0) return "no_work";
  const settled = (r: GridWorkRow) =>
    // isSettled only null-checks completed_at; the boolean is the truth.
    isSettled({ completed_at: r.completed ? "set" : null, waiting_on_client: r.waiting });
  const completed = rows.filter((r) => r.completed).length;
  const open = rows.filter((r) => !settled(r));
  if (open.length === 0) return completed > 0 ? "complete" : "waiting";
  if (open.some((r) => isPastEffectiveDue(r, today))) return "behind";
  if (rows.some(settled)) return "in_progress";
  if (isFuturePeriod(period, today)) return "not_due";
  return "in_progress";
}

export function countCell(
  stream: YearGridStream,
  period: Month,
  months: number[],
  rows: GridWorkRow[],
  today: LocalDate,
): YearGridCell {
  const settled = (r: GridWorkRow) => r.completed || r.waiting;
  return {
    stream,
    year: period.year,
    month: period.month,
    months,
    state: scoreCell(rows, period, today),
    total: rows.length,
    completed: rows.filter((r) => r.completed).length,
    waiting: rows.filter((r) => !r.completed && r.waiting).length,
    open: rows.filter((r) => !settled(r)).length,
    overdue: rows.filter((r) => !settled(r) && isPastEffectiveDue(r, today)).length,
  };
}

const ON_HOLD_NOTES: Partial<Record<ClientWorkState, string>> = {
  paused: "Client is paused. The grid is frozen: nothing accrues and nothing counts while paused.",
  inactive: "Client is inactive. Historical work stays on the record; nothing new generates.",
};

// ── Shared row normalization (per-client grid + firm progression board) ──

type FeedRow = typeof weeklyBankFeeds.$inferSelect;
type ReconRow = typeof accountReconciliations.$inferSelect;
type ReportRow = typeof clientReports.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

/** Weekly feed rows roll up into their attributed month (queue.ts feedPeriod). */
export function feedToGridRow(r: FeedRow): GridWorkRow {
  return {
    period: workPeriodForRow({
      attributed_year: r.attributedYear,
      attributed_month: r.attributedMonth,
      due_date: r.dueDate,
    }),
    completed: r.completedAt != null,
    waiting: r.waitingOnClient,
    dueDate: r.dueDate,
    deferredUntil: r.deferredUntil,
  };
}

export function reconToGridRow(r: ReconRow): GridWorkRow {
  return {
    period: { year: r.attributedYear, month: r.attributedMonth },
    completed: r.completedAt != null,
    waiting: r.waitingOnClient,
    dueDate: r.dueDate,
    deferredUntil: null,
  };
}

export function reportToGridRow(r: ReportRow): GridWorkRow {
  return {
    period: { year: r.attributedYear, month: r.attributedMonth },
    completed: r.completedAt != null,
    waiting: false,
    dueDate: r.dueDate,
    deferredUntil: null,
  };
}

/**
 * Queue parity (queue.ts taskPeriod): stored period wins, then due-date
 * derivation, then the current work period for due-less ad-hoc tasks.
 */
export function taskToGridRow(t: TaskRow, today: LocalDate): GridWorkRow {
  let period: Month;
  if (t.attributedYear != null && t.attributedMonth != null) {
    period = { year: t.attributedYear, month: t.attributedMonth };
  } else if (t.dueDate != null) {
    period = workPeriodForRow({
      attributed_year: t.attributedYear,
      attributed_month: t.attributedMonth,
      due_date: t.dueDate,
      title: t.title,
    });
  } else {
    period = workPeriodForDue(today);
  }
  return {
    period,
    completed: t.status === "completed",
    waiting: t.status === "waiting_on_client",
    dueDate: t.dueDate,
    deferredUntil: null,
  };
}

/**
 * Bucket one stream's normalized rows into cadence columns (off-cadence
 * months roll into the column that closes their period) and score each one.
 */
export function buildStreamRow(
  stream: YearGridStream,
  rows: GridWorkRow[],
  cadenceMonths: number[],
  year: number,
  today: LocalDate,
): YearGridRow {
  const buckets = new Map<number, GridWorkRow[]>();
  for (const row of rows) {
    const columnMonth = columnMonthFor(row.period.month, cadenceMonths);
    const list = buckets.get(columnMonth) ?? [];
    list.push(row);
    buckets.set(columnMonth, list);
  }
  return {
    stream,
    cells: cadenceMonths.map((month, i) =>
      countCell(stream, { year, month }, coveredMonths(i, cadenceMonths), buckets.get(month) ?? [], today),
    ),
  };
}

export async function getClientYearGrid(
  clientId: number,
  year: number,
  today: LocalDate = localToday(),
): Promise<ClientYearGrid | null> {
  await requireStaff();

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return null;

  const domain = toDomainClient(client);
  const state = clientWorkState(domain);
  const cadenceMonths = reportMonthsForFrequency(client.bookkeepingFrequency);
  const columns: Month[] = cadenceMonths.map((month) => ({ year, month }));

  const emptyCell = (stream: YearGridStream, columnIndex: number): YearGridCell => ({
    stream,
    year,
    month: cadenceMonths[columnIndex],
    months: coveredMonths(columnIndex, cadenceMonths),
    state: "not_due",
    total: 0,
    completed: 0,
    waiting: 0,
    open: 0,
    overdue: 0,
  });

  // §6.2: on-hold clients are never scored. Cells freeze at not_due and the
  // header note explains why, instead of grading stale rows.
  if (isOnHold(domain)) {
    return {
      clientId,
      year,
      today: formatLocalDate(today),
      state,
      frequency: client.bookkeepingFrequency,
      onHold: true,
      note: ON_HOLD_NOTES[state] ?? null,
      columns,
      rows: YEAR_GRID_STREAMS.map((stream) => ({
        stream,
        cells: columns.map((_, i) => emptyCell(stream, i)),
      })),
    };
  }

  const [feedRows, reconRows, reportRows, taskRows] = await Promise.all([
    db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.clientId, clientId)),
    db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, clientId),
          eq(accountReconciliations.attributedYear, year),
        ),
      ),
    db
      .select()
      .from(clientReports)
      .where(and(eq(clientReports.clientId, clientId), eq(clientReports.attributedYear, year))),
    db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.clientId, clientId), isNull(tasks.deletedAt), notInArray(tasks.status, ["cancelled"])),
      ),
  ]);

  const rowsByStream: Record<YearGridStream, GridWorkRow[]> = {
    bank_feeds: [],
    reconciliations: [],
    reports: [],
    tasks: [],
  };

  for (const r of feedRows) {
    const row = feedToGridRow(r);
    if (row.period.year !== year) continue;
    rowsByStream.bank_feeds.push(row);
  }
  for (const r of reconRows) {
    rowsByStream.reconciliations.push(reconToGridRow(r));
  }
  for (const r of reportRows) {
    rowsByStream.reports.push(reportToGridRow(r));
  }
  for (const t of taskRows) {
    const row = taskToGridRow(t, today);
    if (row.period.year !== year) continue;
    rowsByStream.tasks.push(row);
  }

  const rows: YearGridRow[] = YEAR_GRID_STREAMS.map((stream) =>
    buildStreamRow(stream, rowsByStream[stream], cadenceMonths, year, today),
  );

  return {
    clientId,
    year,
    today: formatLocalDate(today),
    state,
    frequency: client.bookkeepingFrequency,
    onHold: false,
    note: null,
    columns,
    rows,
  };
}
