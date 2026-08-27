import { and, eq, isNull, ne } from "drizzle-orm";
import {
  isReportTaskName,
  isSettled,
  reverseSyncTargetForTaskTitle,
  setWorkItemCompleted,
  workPeriodForDue,
  workPeriodForRow,
  type Month,
  type ReverseSyncTarget,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  documents,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";

import { localToday, nowIso } from "./dates";
import { stopTaskTimer } from "./time-tracking";

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

type PeriodicKind = ReverseSyncTarget; // "bank_feeds" | "reconciliations" | "client_reports"

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

/**
 * Row → task sync (§6.3): when every row in (client, attributed month, kind)
 * is settled (complete OR waiting_on_client, domain isSettled), auto-complete
 * the month's summary task; when any row re-opens, re-open the task.
 */
async function syncSummaryTask(
  kind: PeriodicKind,
  clientId: number,
  period: Month,
  userId: number,
  now: string,
): Promise<void> {
  const rows = await loadKindRows(kind, clientId, period);
  const allSettled = rows.length > 0 && rows.every((r) => isSettled(rowLike(r)));

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
  const task = candidates.find((t) => reverseSyncTargetForTaskTitle(t.title) === kind);
  if (!task) return;

  if (allSettled && task.status !== "completed") {
    // §6.3 guard applies on every completion path for report tasks.
    if (kind === "client_reports" && !(await reportDocumentExists(clientId, period))) return;
    await setTaskCompleted(task.id, true, userId, now);
  } else if (!allSettled && task.status === "completed") {
    await setTaskCompleted(task.id, false, userId, now);
  }
}

// ── Single-row mutations ──────────────────────────────────────────────────

async function setRowCompleted(
  kind: PeriodicKind,
  id: number,
  completed: boolean,
  userId: number,
  load: () => Promise<AnyRow | undefined>,
): Promise<AnyRow> {
  const row = await load();
  if (!row) throw new Error(`${kind} row ${id} not found`);
  const now = nowIso();
  await applyRowTransition(kind, row, completed, userId, now);
  const clientId = row.clientId;
  await syncSummaryTask(kind, clientId, periodOfRow(row), userId, now);
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

  const now = nowIso();
  await setTaskCompleted(taskId, completed, userId, now);

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
