/**
 * @firmos/domain - work item lifecycle (HANDOFF §6.3, work_item_state.py)
 * plus the due-date semantics every periodic row obeys.
 *
 * Pure: rows are duck-typed, transitions return PATCH OBJECTS for the caller
 * to apply; nothing here touches a database or the clock (HANDOFF §30
 * convention 4 - `now` is always a parameter).
 */

import {
  addDays,
  compareLocalDate,
  dayOfWeek,
  type LocalDate,
  type Month,
} from "./dates.ts";
import { closeTierDueDate, type CloseTier } from "./attribution.ts";

/** HANDOFF §6.3: the client's bank_feed_day_of_week defaults to Friday (0=Sunday convention, §6.4). */
export const DEFAULT_BANK_FEED_DAY_OF_WEEK = 5;

/** HANDOFF §6.3: reconciliations are due max(statement_date + 8 days, tier day). */
export const RECONCILIATION_GRACE_DAYS = 8;

/** Duck-typed completion/parked-state fields shared by all three periodic row types. */
export interface WorkItemRow {
  completed_at?: string | null;
  completed_by_id?: number | null;
  waiting_on_client?: boolean | null;
  deferred_until?: string | null;
}

/** The patch set_work_item_completed applies. */
export interface WorkItemCompletionPatch {
  completed_at: string | null;
  completed_by_id: number | null;
  waiting_on_client?: boolean;
  deferred_until?: null;
}

/**
 * work_item_state.py:51 - HANDOFF §6.3 completion semantics:
 * completing stamps completed_at/completed_by_id and CLEARS the parked
 * state (waiting_on_client + deferred_until) - a finished item is not
 * waiting on anybody, and must not carry a deferral that would hide it
 * again after a re-open. Completing an already-complete row preserves the
 * original timestamp so bulk syncs don't rewrite history.
 */
export function setWorkItemCompleted(
  row: WorkItemRow,
  completed: boolean,
  ctx: { userId: number; now: string },
): WorkItemCompletionPatch {
  if (completed) {
    const already = row.completed_at != null;
    return {
      completed_at: already ? (row.completed_at as string) : ctx.now,
      completed_by_id: already ? (row.completed_by_id ?? ctx.userId) : ctx.userId,
      waiting_on_client: false,
      deferred_until: null,
    };
  }
  return { completed_at: null, completed_by_id: null };
}

/**
 * HANDOFF §6.3 bidirectional sync: for sync purposes a row counts as
 * settled if it is complete OR waiting on client.
 */
export function isSettled(row: Pick<WorkItemRow, "completed_at" | "waiting_on_client">): boolean {
  return row.completed_at != null || row.waiting_on_client === true;
}

export type ReverseSyncTarget = "bank_feeds" | "reconciliations" | "client_reports";

/**
 * HANDOFF §6.3 task → row reverse sync (routes_tasks.py:951): dispatches on
 * the task title. The reconciliation match is an EXACT title comparison, not
 * a substring search - other tasks with "reconcil" in the name are
 * independent. (Compared case-insensitively after trimming; the Python
 * comparison is against the canonical seed title.)
 */
export function reverseSyncTargetForTaskTitle(title: string): ReverseSyncTarget | null {
  const t = title.trim().toLowerCase();
  if (t.includes("categorize") && t.includes("transaction")) return "bank_feeds";
  if (t === "reconcile accounts") return "reconciliations";
  if (t.includes("send report")) return "client_reports";
  return null;
}

/**
 * HANDOFF §6.3 generation: a bank-feed row's due date is the client's
 * bank_feed_day_of_week (default Friday) on or after the period anchor,
 * floored by bank_feed_catchup_date. Rows are always weekly-shaped; the
 * feed frequency only shifts this anchor, not the row granularity.
 */
export function bankFeedDueDate(
  periodAnchor: LocalDate,
  feedDayOfWeek: number = DEFAULT_BANK_FEED_DAY_OF_WEEK,
  catchupDate?: LocalDate | null,
): LocalDate {
  const delta = (feedDayOfWeek - dayOfWeek(periodAnchor) + 7) % 7;
  let due = addDays(periodAnchor, delta);
  if (catchupDate && compareLocalDate(due, catchupDate) < 0) due = catchupDate;
  return due;
}

/**
 * HANDOFF §6.3 generation: a reconciliation row's due date is
 * max(statement_date + 8 days, tier day of that month), floored by any
 * catch-up date. The tier day is the close-tier due date of the accounting
 * month (the 5th/10th/15th of the FOLLOWING month; default 15 for
 * non-monthly clients, §6.1 RULE 1).
 */
export function reconciliationDueDate(
  accountingMonth: Month,
  statementDate: LocalDate,
  tier: CloseTier | null | undefined,
  catchupDate?: LocalDate | null,
): LocalDate {
  const grace = addDays(statementDate, RECONCILIATION_GRACE_DAYS);
  const tierDue = closeTierDueDate(accountingMonth, tier ?? 15);
  let due = compareLocalDate(grace, tierDue) >= 0 ? grace : tierDue;
  if (catchupDate && compareLocalDate(due, catchupDate) < 0) due = catchupDate;
  return due;
}

/**
 * HANDOFF §6.3 generation: report months per frequency - monthly gets all
 * 12, quarterly 3/6/9/12, semi-annual 6/12, annual 12.
 */
export function reportMonthsForFrequency(
  frequency: "monthly" | "quarterly" | "semi_annual" | "annual" | string,
): number[] {
  switch (frequency) {
    case "monthly":
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    case "quarterly":
      return [3, 6, 9, 12];
    case "semi_annual":
      return [6, 12];
    case "annual":
      return [12];
    default:
      return [];
  }
}

/**
 * HANDOFF §32 ("Catch-up date"): "Everything older than this is due by this
 * date" - floors due dates so a newly onboarded or behind client stops
 * showing a wall of false overdues (§22).
 *
 * HANDOFF §32 ("Deferred until"): a date BEFORE WHICH an item is not overdue.
 */
export function effectiveDueDate(
  due: LocalDate,
  opts: { catchupDate?: LocalDate | null; deferredUntil?: LocalDate | null } = {},
): LocalDate {
  let effective = due;
  if (opts.catchupDate && compareLocalDate(due, opts.catchupDate) < 0) effective = opts.catchupDate;
  if (opts.deferredUntil && compareLocalDate(effective, opts.deferredUntil) < 0) {
    effective = opts.deferredUntil;
  }
  return effective;
}

/** An item is overdue when `today` is at/after its effective due date. */
export function isOverdue(
  due: LocalDate,
  today: LocalDate,
  opts: { catchupDate?: LocalDate | null; deferredUntil?: LocalDate | null } = {},
): boolean {
  return compareLocalDate(effectiveDueDate(due, opts), today) <= 0;
}
