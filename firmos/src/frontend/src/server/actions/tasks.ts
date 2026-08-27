"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/server/auth/guards";
import { addTaskNote, getTaskDetail, setSubtaskCompleted, type TaskDetail } from "@/server/task-detail";

/**
 * Task drawer server actions (workstation detail surface). All staff-level:
 * the engine read enforces requireStaff itself; the mutations go through the
 * guard here before touching the engine. Results are typed so the drawer can
 * keep its optimistic checklist in sync with the server.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function getTaskDetailAction(taskId: number): Promise<ActionResult<TaskDetail>> {
  try {
    return { ok: true, data: await getTaskDetail(taskId) };
  } catch (error) {
    return fail(error);
  }
}

export async function setSubtaskCompletedAction(
  subtaskId: number,
  completed: boolean,
): Promise<ActionResult<{ subtaskId: number; isCompleted: boolean }>> {
  try {
    const user = await requireStaff();
    const subtask = await setSubtaskCompleted(subtaskId, completed, user.id);
    revalidatePath("/workstation");
    return { ok: true, data: { subtaskId: subtask.id, isCompleted: subtask.isCompleted } };
  } catch (error) {
    return fail(error);
  }
}

export async function addTaskNoteAction(
  taskId: number,
  body: string,
): Promise<ActionResult<{ noteId: number }>> {
  try {
    const user = await requireStaff();
    const note = await addTaskNote(taskId, body, user.id);
    revalidatePath("/workstation");
    return { ok: true, data: { noteId: note.id } };
  } catch (error) {
    return fail(error);
  }
}
