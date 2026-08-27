import { desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { clients, tasks } from "@/db/schema";

import { logEvent, type DbOrTx } from "./audit";

/**
 * Trash bin engine (HANDOFF §9): tasks soft-deleted via tasks.deleted_at get
 * a recovery surface. The 30-day purge is the scheduled run_recurring job
 * (jobs.ts); this module adds the manual restore and the manual per-row
 * permanent delete. Both mutations are audit-logged (§11); the role gate
 * (admin/owner) lives in the actions layer.
 *
 * Restore clears deleted_at only - status, assignee, and attribution are
 * untouched, so the task re-enters the unified queue exactly where it left.
 * Purge hard-deletes the task row; subtasks, notes, document links, client
 * links, and task timer entries cascade with it (schema onDelete: cascade).
 * The audit row survives the purge by design - audit_events has no delete
 * path.
 */

export class TrashError extends Error {
  constructor(
    public readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TrashError";
  }
}

export interface TrashedTaskItem {
  id: number;
  title: string;
  status: string;
  clientId: number | null;
  clientName: string | null;
  dueDate: string | null;
  attributedYear: number | null;
  attributedMonth: number | null;
  deletedAt: Date;
  /** Days until the scheduled 30-day purge removes this row. */
  purgeInDays: number;
}

/** §9 - trashed rows are purged 30 days after deletion. */
export const TRASH_RETENTION_DAYS = 30;

/** Every soft-deleted task, most recently deleted first. */
export async function listTrashedTasks(now: Date = new Date()): Promise<TrashedTaskItem[]> {
  const rows = await db
    .select({ task: tasks, clientName: clients.legalName, clientDba: clients.dbaName })
    .from(tasks)
    .leftJoin(clients, eq(clients.id, tasks.clientId))
    .where(isNotNull(tasks.deletedAt))
    .orderBy(desc(tasks.deletedAt));

  return rows.map((r) => {
    const deletedAt = r.task.deletedAt as Date;
    const ageDays = Math.floor((now.getTime() - deletedAt.getTime()) / 86_400_000);
    return {
      id: r.task.id,
      title: r.task.title,
      status: r.task.status,
      clientId: r.task.clientId,
      clientName: r.clientDba ?? r.clientName,
      dueDate: r.task.dueDate,
      attributedYear: r.task.attributedYear,
      attributedMonth: r.task.attributedMonth,
      deletedAt,
      purgeInDays: Math.max(0, TRASH_RETENTION_DAYS - ageDays),
    };
  });
}

async function requireTrashedTask(taskId: number) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row || row.deletedAt == null) {
    throw new TrashError(404, "That task is not in the trash");
  }
  return row;
}

/**
 * Restore a trashed task: clears deleted_at so the row re-enters the queue.
 * Audit-logged as task.restore.
 */
export async function restoreTrashedTask(
  taskId: number,
  actorId: number,
  now: Date = new Date(),
): Promise<void> {
  const row = await requireTrashedTask(taskId);
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(tasks.id, row.id));
    await logEvent(
      {
        userId: actorId,
        action: "task.restore",
        entityType: "task",
        entityId: row.id,
        metadata: { title: row.title, clientId: row.clientId, deletedAt: row.deletedAt },
      },
      tx as DbOrTx,
    );
  });
}

/**
 * Permanently delete a trashed task ahead of the scheduled purge. Hard
 * delete; child rows cascade. Audit-logged as task.purge with the identifying
 * metadata, since the row itself is gone afterwards.
 */
export async function purgeTrashedTask(taskId: number, actorId: number): Promise<void> {
  const row = await requireTrashedTask(taskId);
  await db.transaction(async (tx) => {
    await logEvent(
      {
        userId: actorId,
        action: "task.purge",
        entityType: "task",
        entityId: row.id,
        metadata: { title: row.title, clientId: row.clientId, deletedAt: row.deletedAt },
      },
      tx as DbOrTx,
    );
    await tx.delete(tasks).where(eq(tasks.id, row.id));
  });
}
