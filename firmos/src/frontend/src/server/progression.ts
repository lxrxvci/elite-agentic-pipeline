import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import {
  clientWorkState,
  countsForScoring,
  formatLocalDate,
  reportMonthsForFrequency,
  type ClientWorkState,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { requireStaff } from "./auth/guards";
import {
  healthSummaryFromRows,
  staffRefOf,
  type ClientHealthSummary,
  type StaffRef,
} from "./clients";
import { toDomainClient } from "./domain-adapters";
import { localToday } from "./dates";
import {
  YEAR_GRID_STREAMS,
  buildStreamRow,
  feedToGridRow,
  reconToGridRow,
  reportToGridRow,
  taskToGridRow,
  type GridWorkRow,
  type YearGridCell,
  type YearGridCellState,
  type YearGridStream,
} from "./year-grid";

/**
 * getFirmProgressionBoard - the firm-wide heatmap behind /progress: every
 * scored client as a row, Jan-Dec as columns, one client-level cell per
 * month. Cell truth is the SAME engine the per-client year grid uses
 * (src/server/year-grid.ts): each client's rows are normalized, bucketed,
 * and scored per stream per cadence period by the shared helpers, then the
 * four stream cells roll up into one client cell per month.
 *
 * Rollup precedence (mirrors scoreCell's spirit at the client level):
 *  1. no applicable stream (all no_work)          -> no_work
 *  2. any stream behind                           -> behind
 *  3. every applicable stream complete            -> complete (the hero)
 *  4. every applicable stream settled, some parked-> waiting
 *  5. every applicable stream not_due             -> not_due
 *  6. anything else                               -> in_progress
 *
 * Cadence-aware columns: a quarterly client only closes in Mar/Jun/Sep/Dec;
 * the board still renders 12 months and marks off-cadence columns no_work
 * (onCadence: false), so rows align across cadences.
 *
 * One batched pass: clients, staff, and the four work tables are each read
 * once and bucketed in memory - no per-client or per-stream round-trips.
 */

export interface ProgressionStreamSummary {
  stream: YearGridStream;
  state: YearGridCellState;
  total: number;
  completed: number;
  waiting: number;
  open: number;
  overdue: number;
}

export interface ProgressionCell {
  /** Calendar month 1-12 (the board always renders Jan-Dec). */
  month: number;
  /** False when the client's cadence skips this month; renders as no_work. */
  onCadence: boolean;
  state: YearGridCellState;
  /** Per-stream rollup feeding the tooltip; empty off-cadence. */
  streams: ProgressionStreamSummary[];
}

export interface ProgressionRow {
  clientId: number;
  /** Display name (dba when present, else legal). */
  name: string;
  legalName: string;
  state: ClientWorkState;
  frequency: string;
  manager: StaffRef | null;
  bookkeeper: StaffRef | null;
  /** null only for clients the health engine refuses to score. */
  health: ClientHealthSummary | null;
  /** Consecutive complete periods counting back from the last complete one. */
  streak: number;
  /** Any on-cadence cell behind - the "needs attention" filter predicate. */
  needsAttention: boolean;
  /** Always 12 entries, Jan-Dec. */
  cells: ProgressionCell[];
}

export interface FirmProgressionBoard {
  year: number;
  /** Firm-local today, ISO-local. */
  today: string;
  months: number[];
  rows: ProgressionRow[];
  /**
   * Row-weighted firm completion per month (completed rows / total rows
   * across every scored client's applicable streams); null when no work at
   * all is attributed to that month.
   */
  columnCompletion: (number | null)[];
}

const BOARD_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Client-level rollup of one column's per-stream cells (precedence above). */
export function aggregateStreamCells(cells: YearGridCell[]): YearGridCellState {
  const applicable = cells.filter((c) => c.state !== "no_work");
  if (applicable.length === 0) return "no_work";
  if (applicable.some((c) => c.state === "behind")) return "behind";
  if (applicable.every((c) => c.state === "complete")) return "complete";
  if (applicable.every((c) => c.state === "complete" || c.state === "waiting")) return "waiting";
  if (applicable.every((c) => c.state === "not_due")) return "not_due";
  return "in_progress";
}

/**
 * Close streak: consecutive complete periods counting back from the last
 * complete one (off-cadence months skipped, so a quarterly client's streak
 * counts quarters). A run interrupted by a not-yet-due future period still
 * counts - the streak measures the firm's closing habit, not the calendar.
 */
export function closeStreak(cells: ProgressionCell[]): number {
  const periods = cells.filter((c) => c.onCadence);
  let lastComplete = -1;
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].state === "complete") {
      lastComplete = i;
      break;
    }
  }
  if (lastComplete < 0) return 0;
  let streak = 0;
  for (let i = lastComplete; i >= 0 && periods[i].state === "complete"; i--) streak++;
  return streak;
}

function summarizeCell(cell: YearGridCell): ProgressionStreamSummary {
  return {
    stream: cell.stream,
    state: cell.state,
    total: cell.total,
    completed: cell.completed,
    waiting: cell.waiting,
    open: cell.open,
    overdue: cell.overdue,
  };
}

export async function getFirmProgressionBoard(
  year: number,
  today: LocalDate = localToday(),
): Promise<FirmProgressionBoard> {
  await requireStaff();

  const [clientRows, userRows, feedRows, reconRows, reportRows, taskRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.legalName)),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users),
    db.select().from(weeklyBankFeeds),
    db
      .select()
      .from(accountReconciliations)
      .where(eq(accountReconciliations.attributedYear, year)),
    db.select().from(clientReports).where(eq(clientReports.attributedYear, year)),
    db
      .select()
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), notInArray(tasks.status, ["cancelled"]))),
  ]);

  const userById = new Map(userRows.map((u) => [u.id, u]));

  // Bucket every work row by client once, then score per client in memory.
  const feedsByClient = new Map<number, typeof feedRows>();
  const reconsByClient = new Map<number, typeof reconRows>();
  const reportsByClient = new Map<number, typeof reportRows>();
  const tasksByClient = new Map<number, typeof taskRows>();
  for (const r of feedRows) feedsByClient.set(r.clientId, [...(feedsByClient.get(r.clientId) ?? []), r]);
  for (const r of reconRows) reconsByClient.set(r.clientId, [...(reconsByClient.get(r.clientId) ?? []), r]);
  for (const r of reportRows) reportsByClient.set(r.clientId, [...(reportsByClient.get(r.clientId) ?? []), r]);
  for (const t of taskRows) {
    if (t.clientId != null) tasksByClient.set(t.clientId, [...(tasksByClient.get(t.clientId) ?? []), t]);
  }

  const rows: ProgressionRow[] = [];
  for (const client of clientRows) {
    const domain = toDomainClient(client);
    // §6.2: on-hold clients (paused/inactive) are never scored, so they
    // never appear on the board - their cells would freeze at not_due and
    // read as healthy, which is exactly the lie the freeze exists to avoid.
    if (!countsForScoring(domain)) continue;

    const cadenceMonths = reportMonthsForFrequency(client.bookkeepingFrequency);

    const rowsByStream: Record<YearGridStream, GridWorkRow[]> = {
      bank_feeds: [],
      reconciliations: [],
      reports: [],
      tasks: [],
    };
    for (const r of feedsByClient.get(client.id) ?? []) {
      const row = feedToGridRow(r);
      if (row.period.year === year) rowsByStream.bank_feeds.push(row);
    }
    for (const r of reconsByClient.get(client.id) ?? []) {
      rowsByStream.reconciliations.push(reconToGridRow(r));
    }
    for (const r of reportsByClient.get(client.id) ?? []) {
      rowsByStream.reports.push(reportToGridRow(r));
    }
    for (const t of tasksByClient.get(client.id) ?? []) {
      const row = taskToGridRow(t, today);
      if (row.period.year === year) rowsByStream.tasks.push(row);
    }

    const streamRows = YEAR_GRID_STREAMS.map((stream) =>
      buildStreamRow(stream, rowsByStream[stream], cadenceMonths, year, today),
    );

    // Normalize the cadence columns onto the 12-month board axis.
    const cells: ProgressionCell[] = BOARD_MONTHS.map((month) => {
      const columnIndex = cadenceMonths.indexOf(month);
      if (columnIndex === -1) {
        return { month, onCadence: false, state: "no_work" as const, streams: [] };
      }
      const streamCells = streamRows.map((r) => r.cells[columnIndex]);
      return {
        month,
        onCadence: true,
        state: aggregateStreamCells(streamCells),
        streams: streamCells.map(summarizeCell),
      };
    });

    rows.push({
      clientId: client.id,
      name: client.dbaName ?? client.legalName,
      legalName: client.legalName,
      state: clientWorkState(domain),
      frequency: client.bookkeepingFrequency,
      manager: client.managerId != null ? staffRefOf(userById.get(client.managerId)) : null,
      bookkeeper: client.bookkeeperId != null ? staffRefOf(userById.get(client.bookkeeperId)) : null,
      health: healthSummaryFromRows(
        client,
        {
          feeds: feedsByClient.get(client.id) ?? [],
          recons: reconsByClient.get(client.id) ?? [],
          reports: reportsByClient.get(client.id) ?? [],
          openTasks: (tasksByClient.get(client.id) ?? []).filter(
            (t) => t.status !== "completed" && t.status !== "cancelled",
          ),
        },
        today,
      ),
      streak: closeStreak(cells),
      needsAttention: cells.some((c) => c.state === "behind"),
      cells,
    });
  }

  // Column footer: row-weighted completion per month across the firm.
  const columnCompletion = BOARD_MONTHS.map((month) => {
    let total = 0;
    let completed = 0;
    for (const row of rows) {
      const cell = row.cells[month - 1];
      if (!cell.onCadence) continue;
      for (const s of cell.streams) {
        total += s.total;
        completed += s.completed;
      }
    }
    return total > 0 ? Math.round((completed / total) * 100) : null;
  });

  return {
    year,
    today: formatLocalDate(today),
    months: BOARD_MONTHS,
    rows,
    columnCompletion,
  };
}
