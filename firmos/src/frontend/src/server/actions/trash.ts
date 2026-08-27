"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireRole } from "@/server/auth/guards";
import {
  purgeTrashedTask,
  restoreTrashedTask,
  TrashError,
} from "@/server/trash";

/**
 * Trash bin server actions (HANDOFF §9, §11). Admin/owner only - the page
 * layout renders nothing for other roles and every mutation re-checks here.
 * Restore clears deleted_at; purge hard-deletes ahead of the scheduled
 * 30-day job. Both are audit-logged in the engine.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof TrashError) return { ok: false, error: error.message };
  if (error instanceof AuthError) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: false, error: "Something went wrong - try again." };
}

export async function restoreTaskAction(
  taskId: number,
): Promise<ActionResult<{ restored: true }>> {
  try {
    const user = await requireRole("admin", "owner");
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return { ok: false, error: "That task is not in the trash" };
    }
    await restoreTrashedTask(taskId, user.id);
    revalidatePath("/admin/trash");
    return { ok: true, data: { restored: true } };
  } catch (error) {
    return failure(error);
  }
}

export async function purgeTaskAction(
  taskId: number,
): Promise<ActionResult<{ purged: true }>> {
  try {
    const user = await requireRole("admin", "owner");
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return { ok: false, error: "That task is not in the trash" };
    }
    await purgeTrashedTask(taskId, user.id);
    revalidatePath("/admin/trash");
    return { ok: true, data: { purged: true } };
  } catch (error) {
    return failure(error);
  }
}
