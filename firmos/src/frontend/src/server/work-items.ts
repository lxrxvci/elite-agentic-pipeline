import { and, eq, isNull, ne } from "drizzle-orm";
import {
  addDays,
  compareLocalDate,
  formatLocalDate,
  incompleteSubtaskCount,
  isReportTaskName,
  isSettled,
  parseLocalDate,
  reverseSyncTargetForTaskTitle,
  setWorkItemCompleted,
  workPeriodForDue,
  workPeriodForRow,
  type LocalDate,
  type Month,
  type ReverseSyncTarget,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  documents,
  tasks,
  taskSubtasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import {
  KIND_ACTIVITY_TYPE,
  type PeriodicWorkKind,
} from "@/shared/lib/work-kind";
import {
  ROLLOVER_SUPPORT,
  type RolloverAction,
  type RolloverDecision,
} from "@/shared/lib/rollover";

import { assertBumperLaneAllows } from "./bumper-lanes";
import { localToday, nowIso } from "./dates";
import { stopActivityTimer, stopTaskTimer, type NonDayActivityType } from "./time-tracking";

/**
 * Completion mutations + bidirectional sync (HANDOFF §6.3).
 *
 * Every row transition goes through the domain's setWorkItemCompleted
 * (§30 conv. 3): completing stamps completed_at/completed_by_id and clears
 * the parked state (waiting_on_client + deferred_until); re-completing an
 * already-complete row preserves the original timestamp; re-opening clears
 * only the completion stamps.
 *
 * Sync buckets rows by the SAME accounting month on both directions
 * (§30 conv. 6): workPeriodForRow reads the stored attributed year/month,
 * which generation wrote with the same domain functions.
 *
 * Completing a task also clocks the acting user out of it (call notes):
 * completeTask stops the user's open task_time_entries interval at the
 * completion moment.
 */

/** Thrown when a report task is completed before its report document exists (§6.3 guard). */
export class ReportDocumentRequiredError extends Error {
  constructor(taskId: number, period: Month) {
    super(
      `report task ${taskId} cannot be completed: no report document exists for ` +
        `${period.year}-${String(period.month).padStart(2, "0")}`,
    );
    this.name = "ReportDocumentRequiredError";
  }
}

/**
 * B4 (owner walkthrough, 00:29:44): a parent task cannot complete while it
 * has incomplete subtasks - "collect logins" only closes when the
 * Chase/Stripe/... subtasks are all collected. The count comes from the
 * domain's incompleteSubtaskCount; re-opening is never gated.
 */
export class SubtasksIncompleteError extends Error {
  constructor(
    taskId: number,
    public readonly incompleteCount: number,
  ) {
    super(
      `task ${taskId} cannot be completed: ${incompleteCount} subtask${incompleteCount === 1 ? "" : "s"} still open`,
    );
    this.name = "SubtasksIncompleteError";
  }
}

type PeriodicKind = ReverseSyncTarget; // "bank_feeds" | "reconciliations" | "client_reports"

/** PeriodicKind -> the queue's card kind (the lane gate speaks card kinds). */
const CARD_KIND: Record<PeriodicKind, "bank_feed" | "reconciliation" | "report"> = {
  bank_feeds: "bank_feed",
  reconciliations: "reconciliation",
  client_reports: "report",
};

type FeedRow = typeof weeklyBankFeeds.$inferSelect;
type ReconRow = typeof accountReconciliations.$inferSelect;
type ReportRow = typeof clientReports.$inferSelect;
type AnyRow = FeedRow | ReconRow | ReportRow;

function rowLike(row: AnyRow) {
  return {
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    completed_by_id: row.completedById ?? null,
    waiting_on_client: "waitingOnClient" in row ? (row.waitingOnClient ?? false) : false,
    deferred_until: "deferredUntil" in row ? (row.deferredUntil ?? null) : null,
  };
}

function periodOfRow(row: AnyRow): Month {
  return workPeriodForRow({
    attributed_year: row.attributedYear,
    attributed_month: row.attributedMonth,
    due_date: "dueDate" in row ? row.dueDate : null,
  });
}

async function loadKindRows(kind: PeriodicKind, clientId: number, period: Month): Promise<AnyRow[]> {
  switch (kind) {
    case "bank_feeds":
      return db
        .select()
        .from(weeklyBankFeeds)
        .where(
          and(
            eq(weeklyBankFeeds.clientId, clientId),
            eq(weeklyBankFeeds.attributedYear, period.year),
            eq(weeklyBankFeeds.attributedMonth, period.month),
          ),
        );
    case "reconciliations":
      return db
        .select()
        .from(accountReconciliations)
        .where(
          and(
            eq(accountReconciliations.clientId, clientId),
            eq(accountReconciliations.attributedYear, period.year),
            eq(accountReconciliations.attributedMonth, period.month),
          ),
        );
    case "client_reports":
      return db
        .select()
        .from(clientReports)
        .where(
          and(
            eq(clientReports.clientId, clientId),
            eq(clientReports.attributedYear, period.year),
            eq(clientReports.attributedMonth, period.month),
          ),
        );
  }
}

/** Apply setWorkItemCompleted to one row and persist. No sync side effects. */
async function applyRowTransition(
  kind: PeriodicKind,
  row: AnyRow,
  completed: boolean,
  userId: number,
  now: string,
): Promise<void> {
  const patch = setWorkItemCompleted(rowLike(row), completed, { userId, now });
  const base = {
    completedAt: patch.completed_at ? new Date(patch.completed_at) : null,
    completedById: patch.completed_by_id,
    updatedAt: new Date(),
  };
  switch (kind) {
    case "bank_feeds":
      await db
        .update(weeklyBankFeeds)
        .set(
          completed
            ? { ...base, waitingOnClient: false, deferredUntil: null }
            : base,
        )
        .where(eq(weeklyBankFeeds.id, row.id));
      return;
    case "reconciliations":
      await db
        .update(accountReconciliations)
        .set(completed ? { ...base, waitingOnClient: false } : base)
        .where(eq(accountReconciliations.id, row.id));
      return;
    case "client_reports":
      // Reports have neither waiting nor deferral (§6.3).
      await db.update(clientReports).set(base).where(eq(clientReports.id, row.id));
      return;
  }
}

async function reportDocumentExists(clientId: number, period: Month): Promise<boolean> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.clientId, clientId),
        eq(documents.docType, "report"),
        eq(documents.attributedYear, period.year),
        eq(documents.attributedMonth, period.month),
      ),
    )
    .limit(1);
  return doc != null;
}

async function setTaskCompleted(taskId: number, completed: boolean, userId: number, now: string) {
  await db
    .update(tasks)
    .set(
      completed
        ? { status: "completed" as const, completedAt: new Date(now), completedById: userId, updatedAt: new Date() }
        : { status: "open" as const, completedAt: null, completedById: null, updatedAt: new Date() },
    )
    .where(eq(tasks.id, taskId));
}

/** The month's summary task for a periodic kind (title match, §6.3/§19). */
async function findSummaryTask(
  kind: PeriodicKind,
  clientId: number,
  period: Month,
): Promise<typeof tasks.$inferSelect | undefined> {
  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.clientId, clientId),
        eq(tasks.attributedYear, period.year),
        eq(tasks.attributedMonth, period.month),
        isNull(tasks.deletedAt),
        ne(tasks.status, "cancelled"),
      ),
    );
  return candidates.find((t) => reverseSyncTargetForTaskTitle(t.title) === kind);
}

/**
 * Row → task sync (§6.3): when every row in (client, attributed month, kind)
 * is settled (complete OR waiting_on_client, domain isSettled), auto-complete
 * the month's summary task; when any row re-opens, re-open the task.
 * Returns true only when this call completed the task (the upload wiring
 * surfaces that to the drawer so it can celebrate the auto-close).
 */
async function syncSummaryTask(
  kind: PeriodicKind,
  clientId: number,
  period: Month,
  userId: number,
  now: string,
): Promise<boolean> {
  const rows = await loadKindRows(kind, clientId, period);
  const allSettled = rows.length > 0 && rows.every((r) => isSettled(rowLike(r)));
  const task = await findSummaryTask(kind, clientId, period);
  if (!task) return false;

  if (allSettled && task.status !== "completed") {
    // §6.3 guard applies on every completion path for report tasks.
    if (kind === "client_reports" && !(await reportDocumentExists(clientId, period))) return false;
    await setTaskCompleted(task.id, true, userId, now);
    return true;
  } else if (!allSettled && task.status === "completed") {
    await setTaskCompleted(task.id, false, userId, now);
  }
  return false;
}

// ── Single-row mutations ──────────────────────────────────────────────────

async function setRowCompleted(
  kind: PeriodicKind,
  id: number,
  completed: boolean,
  userId: number,
  load: () => Promise<AnyRow | undefined>,
): Promise<AnyRow> {
  // D6/D8: with bumper lanes on, a lane-locked card completes only through
  // an active override (checked inside the gate). Re-opening is never gated.
  if (completed) await assertBumperLaneAllows(userId, CARD_KIND[kind], id);
  const row = await load();
  if (!row) throw new Error(`${kind} row ${id} not found`);
  const now = nowIso();
  await applyRowTransition(kind, row, completed, userId, now);
  await syncSummaryTask(kind, row.clientId, periodOfRow(row), userId, now);
  // D5: completing a periodic card stops the user's matching activity timer,
  // mirroring the task rule ("once the task is done, it clocks you out of
  // it"). No-op when no matching activity is running.
  if (completed) {
    await stopActivityTimer(
      userId,
      KIND_ACTIVITY_TYPE[CARD_KIND[kind]] as NonDayActivityType,
      row.clientId,
      new Date(now),
    );
  }
  const updated = await load();
  return updated as AnyRow;
}

export async function setBankFeedCompleted(
  id: number,
  completed: boolean,
  userId: number,
): Promise<FeedRow> {
  const load = async () =>
    (await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, id)).limit(1))[0];
  return (await setRowCompleted("bank_feeds", id, completed, userId, load)) as FeedRow;
}

export async function setReconciliationCompleted(
  id: number,
  completed: boolean,
  userId: number,
): Promise<ReconRow> {
  const load = async () =>
    (await db.select().from(accountReconciliations).where(eq(accountReconciliations.id, id)).limit(1))[0];
  return (await setRowCompleted("reconciliations", id, completed, userId, load)) as ReconRow;
}

export async function setReportCompleted(
  id: number,
  completed: boolean,
  userId: number,
): Promise<ReportRow> {
  const load = async () =>
    (await db.select().from(clientReports).where(eq(clientReports.id, id)).limit(1))[0];
  return (await setRowCompleted("client_reports", id, completed, userId, load)) as ReportRow;
}

// ── Report upload wiring (the drawer's DO surface) ────────────────────────

export interface ReportUploadCompletion {
  /** Report rows this upload completed (already-complete rows stay put). */
  completedRowIds: number[];
  /** True when the upload tipped the month: the "Send Reports" summary task
      auto-completed through the §6.3 row → task sync. */
  summaryTaskCompleted: boolean;
}

/**
 * A report file landed for (client, period): link it to the period's report
 * rows and complete the open ones (schema §7: a report row "completes by
 * uploading the report file"). The summary task then closes through the
 * EXISTING bidirectional sync - which now passes its §6.3 document guard
 * because the upload already inserted the doc_type='report' row.
 *
 * The lane gate (D6/D8) is checked up front for every row we would complete,
 * so a lane-locked month fails BEFORE any row moves; the document itself was
 * already stored by the caller (uploads are never lane-gated).
 */
export async function completeReportRowsForDocument(
  clientId: number,
  period: Month,
  documentId: number,
  userId: number,
): Promise<ReportUploadCompletion> {
  const rows = (await loadKindRows("client_reports", clientId, period)) as ReportRow[];
  const open = rows.filter((r) => r.completedAt == null);
  for (const row of open) {
    await assertBumperLaneAllows(userId, "report", row.id);
  }

  const now = nowIso();
  const completedRowIds: number[] = [];
  for (const row of rows) {
    // Every row of the period points at the latest file; open rows complete
    // through the same domain transition as the card completer (§30 conv. 3).
    await db
      .update(clientReports)
      .set({ documentId, updatedAt: new Date() })
      .where(eq(clientReports.id, row.id));
    if (row.completedAt == null) {
      await applyRowTransition("client_reports", row, true, userId, now);
      completedRowIds.push(row.id);
    }
  }

  let summaryTaskCompleted = await syncSummaryTask("client_reports", clientId, period, userId, now);

  // Zero-row periods (the recurring "Send Reports" rule can outrun the
  // client's report definitions - the task exists, no report rows do): the
  // row → task sync deliberately requires rows, but the upload IS the
  // explicit finish, so close the summary task through the task path itself
  // (completeTask keeps every guard: the document check now passes, the B4
  // checklist gate and the D6/D8 lane gate still apply).
  if (!summaryTaskCompleted && rows.length === 0) {
    const task = await findSummaryTask("client_reports", clientId, period);
    if (task && task.status !== "completed") {
      await completeTask(task.id, true, userId);
      summaryTaskCompleted = true;
    }
  }

  // D5 parity: finishing report work stops the user's report activity timer
  // (completeTask already stopped the per-task timer in the zero-row path).
  if (completedRowIds.length > 0 || summaryTaskCompleted) {
    await stopActivityTimer(
      userId,
      KIND_ACTIVITY_TYPE.report as NonDayActivityType,
      clientId,
      new Date(now),
    );
  }

  return { completedRowIds, summaryTaskCompleted };
}

// ── Task → row sync ───────────────────────────────────────────────────────

/**
 * completeTask (§6.3 reverse sync): dispatches on the task title via the
 * domain's reverseSyncTargetForTaskTitle and completes/re-opens every row in
 * the task's attributed month through the same setWorkItemCompleted
 * transition. Report tasks are guarded: no report document, no completion.
 */
export async function completeTask(
  taskId: number,
  completed: boolean,
  userId: number,
): Promise<typeof tasks.$inferSelect> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`task ${taskId} not found`);

  // D6/D8 lane gate (same construction as the row completers; completion
  // only - re-opening stays ungated).
  if (completed) await assertBumperLaneAllows(userId, "task", taskId);

  // Same fallback as the queue: period-less ad-hoc tasks belong to the
  // current work period rather than crashing completion.
  const period: Month =
    task.attributedYear != null && task.attributedMonth != null
      ? { year: task.attributedYear, month: task.attributedMonth }
      : task.dueDate != null
        ? workPeriodForRow({
            attributed_year: task.attributedYear,
            attributed_month: task.attributedMonth,
            due_date: task.dueDate,
            title: task.title,
          })
        : workPeriodForDue(localToday());

  if (completed && isReportTaskName(task.title)) {
    if (task.clientId == null || !(await reportDocumentExists(task.clientId, period))) {
      throw new ReportDocumentRequiredError(taskId, period);
    }
  }

  // B4 gating: a parent with an open checklist cannot complete (completing
  // every subtask first is the only way through; re-opening is ungated).
  if (completed) {
    const subtaskRows = await db
      .select({ isCompleted: taskSubtasks.isCompleted })
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, taskId));
    const openCount = incompleteSubtaskCount(subtaskRows.map((s) => ({ is_completed: s.isCompleted })));
    if (openCount > 0) throw new SubtasksIncompleteError(taskId, openCount);
  }

  const now = nowIso();
  await setTaskCompleted(taskId, completed, userId, now);

  // E6 (09_30 00:56:49): "once they've been marked as addressed, then the
  // timer goes off - you have seven days to send these reports out."
  // Completing the period's Client Questions task pulls the same period's
  // open Send Reports task to completion + 7 days (firm-local).
  if (
    completed &&
    task.title === "Client Questions" &&
    task.clientId != null &&
    task.attributedYear != null &&
    task.attributedMonth != null
  ) {
    const reportsDue = formatLocalDate(addDays(parseLocalDate(now.slice(0, 10)), 7));
    await db
      .update(tasks)
      .set({ dueDate: reportsDue })
      .where(
        and(
          eq(tasks.clientId, task.clientId),
          eq(tasks.title, "Send Reports"),
          eq(tasks.attributedYear, task.attributedYear),
          eq(tasks.attributedMonth, task.attributedMonth),
          isNull(tasks.completedAt),
        ),
      );
  }

  // Call notes: "once the task is marked as done, it clocks you out of it" -
  // completing closes the acting user's open timer on the task. stopTaskTimer
  // is a no-op when nothing is running, and re-opening never resurrects the
  // closed interval (it only clears the completion stamps).
  if (completed) {
    await stopTaskTimer(userId, taskId, new Date(now));
  }

  const target = reverseSyncTargetForTaskTitle(task.title);
  if (target && task.clientId != null) {
    const rows = await loadKindRows(target, task.clientId, period);
    for (const row of rows) {
      // Direct transition only - the task itself is already set above, and
      // routing these back through syncSummaryTask would be circular.
      await applyRowTransition(target, row, completed, userId, now);
    }
  }

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return updated;
}

// ── Guided rollover (anti-overwhelm D3) ───────────────────────────────────

/**
 * The morning rollover ritual: yesterday's unfinished items get an explicit
 * decision instead of silently turning red. One batch entry point for the
 * rollover dialog; per-kind support comes from the shared ROLLOVER_SUPPORT
 * matrix (schema truth: feeds defer + wait, tasks wait via status,
 * reconciliations/reports re-anchor to today only).
 *
 * Re-anchor semantics ("Today"): feeds set deferred_until = today (the
 * queue's effectiveDueDate then lands them in due_today without touching the
 * original due date); tasks/reconciliations/reports move due_date to today.
 * Deliberately audit-event-free: defer/waiting are parked-state transitions,
 * which §6.3 does not audit.
 */

export interface RolloverSkip {
  kind: RolloverDecision["kind"];
  id: number;
  reason: string;
}

export interface RolloverResult {
  applied: RolloverDecision[];
  skipped: RolloverSkip[];
}

function formatToday(today: LocalDate): string {
  const m = String(today.month).padStart(2, "0");
  const d = String(today.day).padStart(2, "0");
  return `${today.year}-${m}-${d}`;
}

export async function applyRolloverDecisions(
  userId: number,
  decisions: RolloverDecision[],
  today: LocalDate = localToday(),
): Promise<RolloverResult> {
  const todayIso = formatToday(today);
  const result: RolloverResult = { applied: [], skipped: [] };
  const now = new Date();

  const skip = (d: RolloverDecision, reason: string) =>
    result.skipped.push({ kind: d.kind, id: d.id, reason });

  // Assignment scope (same derivation as the queue): tasks assign directly;
  // feeds/reconciliations follow the client's bookkeeper, reports its
  // manager. The dialog only offers the user's own overdue items - this is
  // the server-side enforcement of that scope.
  const [me] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me) throw new Error(`user ${userId} not found`);
  const clientRows = await db
    .select({
      id: clients.id,
      bookkeeperId: clients.bookkeeperId,
      managerId: clients.managerId,
    })
    .from(clients);
  const clientById = new Map(clientRows.map((c) => [c.id, c]));
  const assignedToMe = (kind: RolloverDecision["kind"], assigneeId: number | null, clientId: number | null) => {
    if (kind === "task") return assigneeId === userId;
    const client = clientId != null ? clientById.get(clientId) : undefined;
    if (!client) return false;
    return kind === "report" ? client.managerId === userId : client.bookkeeperId === userId;
  };

  for (const d of decisions) {
    if (!ROLLOVER_SUPPORT[d.kind].includes(d.action)) {
      skip(d, `${d.kind} does not support "${d.action}"`);
      continue;
    }
    if (d.action === "defer") {
      const until = d.until;
      if (until == null || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        skip(d, "Defer needs a date (YYYY-MM-DD)");
        continue;
      }
      // Deferring into the past is a no-op decision; today-or-later only.
      if (compareLocalDate(parseLocalDate(until), today) < 0) {
        skip(d, "Defer date cannot be in the past");
        continue;
      }
    }

    switch (d.kind) {
      case "bank_feed": {
        const [row] = await db
          .select()
          .from(weeklyBankFeeds)
          .where(eq(weeklyBankFeeds.id, d.id))
          .limit(1);
        if (!row || row.completedAt != null) {
          skip(d, "Not found or already complete");
          continue;
        }
        if (!assignedToMe(d.kind, null, row.clientId)) {
          skip(d, "Not assigned to you");
          continue;
        }
        if (d.action === "waiting_on_client") {
          await db
            .update(weeklyBankFeeds)
            .set({ waitingOnClient: true, deferredUntil: null, updatedAt: now })
            .where(eq(weeklyBankFeeds.id, d.id));
        } else {
          // today -> re-anchor to today; defer -> re-anchor to the pick.
          await db
            .update(weeklyBankFeeds)
            .set({
              deferredUntil: d.action === "defer" ? (d.until as string) : todayIso,
              updatedAt: now,
            })
            .where(eq(weeklyBankFeeds.id, d.id));
        }
        result.applied.push(d);
        continue;
      }
      case "task": {
        const [row] = await db.select().from(tasks).where(eq(tasks.id, d.id)).limit(1);
        if (!row || row.deletedAt != null || row.status === "completed" || row.status === "cancelled") {
          skip(d, "Not found or already complete");
          continue;
        }
        if (!assignedToMe(d.kind, row.assigneeId, row.clientId)) {
          skip(d, "Not assigned to you");
          continue;
        }
        if (d.action === "waiting_on_client") {
          await db
            .update(tasks)
            .set({ status: "waiting_on_client", updatedAt: now })
            .where(eq(tasks.id, d.id));
        } else {
          await db
            .update(tasks)
            .set({ dueDate: todayIso, updatedAt: now })
            .where(eq(tasks.id, d.id));
        }
        result.applied.push(d);
        continue;
      }
      case "reconciliation": {
        const [row] = await db
          .select()
          .from(accountReconciliations)
          .where(eq(accountReconciliations.id, d.id))
          .limit(1);
        if (!row || row.completedAt != null) {
          skip(d, "Not found or already complete");
          continue;
        }
        if (!assignedToMe(d.kind, null, row.clientId)) {
          skip(d, "Not assigned to you");
          continue;
        }
        // Today is the only supported action (enforced above).
        await db
          .update(accountReconciliations)
          .set({ dueDate: todayIso, updatedAt: now })
          .where(eq(accountReconciliations.id, d.id));
        result.applied.push(d);
        continue;
      }
      case "report": {
        const [row] = await db
          .select()
          .from(clientReports)
          .where(eq(clientReports.id, d.id))
          .limit(1);
        if (!row || row.completedAt != null) {
          skip(d, "Not found or already complete");
          continue;
        }
        if (!assignedToMe(d.kind, null, row.clientId)) {
          skip(d, "Not assigned to you");
          continue;
        }
        await db
          .update(clientReports)
          .set({ dueDate: todayIso, updatedAt: now })
          .where(eq(clientReports.id, d.id));
        result.applied.push(d);
        continue;
      }
    }
  }
  return result;
}
