"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/server/auth/guards";
import {
  addQuickNote,
  deleteQuickNote,
  listQuickAddOptions,
  listQuickNotes,
  logMeeting,
  quickAddTask,
  type LogMeetingInput,
  type QuickTaskInput,
} from "@/server/quick-add";
import { mintAdHocTask } from "@/server/templates";

/**
 * Quick-add server actions - the "Y button" surface. Every action is
 * staff-level (requireStaff; portal roles rejected at the guard, §11) and
 * returns a typed ActionResult instead of throwing, so the compact dialogs
 * can render the error inline.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function quickAddOptionsAction(): Promise<ActionResult<Awaited<ReturnType<typeof listQuickAddOptions>>>> {
  try {
    await requireStaff();
    return { ok: true, data: await listQuickAddOptions() };
  } catch (error) {
    return fail(error);
  }
}

export async function addQuickNoteAction(
  input: { clientId?: number | null; body: string },
): Promise<ActionResult<Awaited<ReturnType<typeof addQuickNote>>>> {
  try {
    const user = await requireStaff();
    const note = await addQuickNote(input, user.id);
    revalidatePath("/notes");
    return { ok: true, data: note };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteQuickNoteAction(noteId: number): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requireStaff();
    await deleteQuickNote(noteId, user.id);
    revalidatePath("/notes");
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function listQuickNotesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listQuickNotes>>>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await listQuickNotes(user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function quickAddTaskAction(
  input: QuickTaskInput,
): Promise<ActionResult<Awaited<ReturnType<typeof quickAddTask>>>> {
  try {
    const user = await requireStaff();
    const task = await quickAddTask(input, user.id);
    revalidatePath("/workstation");
    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

export async function mintFromTemplateAction(
  templateId: number,
  clientId: number,
  overrides?: { assigneeId?: number | null; dueDate?: string },
): Promise<ActionResult<Awaited<ReturnType<typeof mintAdHocTask>>>> {
  try {
    const user = await requireStaff();
    const task = await mintAdHocTask(templateId, clientId, user.id, undefined, overrides);
    revalidatePath("/workstation");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

export async function logMeetingAction(
  input: LogMeetingInput,
): Promise<ActionResult<Awaited<ReturnType<typeof logMeeting>>>> {
  try {
    const user = await requireStaff();
    const result = await logMeeting(input, user.id);
    revalidatePath("/workstation");
    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
