"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clients } from "@/db/schema";

import {
  AuthError,
  canEditSops,
  canEditTaskTemplates,
  requireRole,
  requireStaff,
} from "@/server/auth/guards";
import {
  addProjectTemplateTask,
  applySopToClient,
  createAdHocTemplate,
  createOffboardingTemplate,
  createOnboardingTemplate,
  createProjectFromTemplate,
  createProjectTemplate,
  createRecurringTemplate,
  createSopTemplate,
  deleteAdHocTemplate,
  deleteOffboardingTemplate,
  deleteOnboardingTemplate,
  deleteProjectTemplate,
  deleteProjectTemplateTask,
  deleteRecurringTemplate,
  deleteSopTemplate,
  finalizeOffboardingWhenComplete,
  getProjectTemplateWithTasks,
  linkSopToAdHocTemplate,
  listAdHocTemplates,
  listClientManualEntries,
  listOffboardingTemplates,
  listOnboardingTemplates,
  listProjectTemplates,
  listRecurringTemplates,
  listSopTemplates,
  mintAdHocTask,
  setProjectTaskCompleted,
  startOffboarding,
  updateAdHocTemplate,
  updateOffboardingTemplate,
  updateOnboardingTemplate,
  updateProjectTemplate,
  updateRecurringTemplate,
  updateSopTemplate,
  type AdHocTemplateInput,
  type ProjectTemplateTaskInput,
  type RecurringTemplateInput,
} from "@/server/templates";

/**
 * Template server actions (HANDOFF §19, §22). Admin CRUD on the six
 * template systems is gated by the §11 delegated-permission flags:
 * can_edit_sops for SOP templates, can_edit_task_templates for the five
 * task-side systems (owner/admin pass either check by construction).
 * Application paths (apply SOP, mint ad-hoc task, project from template)
 * are staff-level; offboarding start is admin/owner per §22.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

async function requireSopEditor() {
  const user = await requireStaff();
  if (!canEditSops(user)) throw new AuthError(403, "Requires the can_edit_sops permission");
  return user;
}

async function requireTaskTemplateEditor() {
  const user = await requireStaff();
  if (!canEditTaskTemplates(user)) throw new AuthError(403, "Requires the can_edit_task_templates permission");
  return user;
}

// ── SOPs (§19 system 1) ───────────────────────────────────────────────────

export async function listSopTemplatesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listSopTemplates>>>> {
  try {
    await requireStaff();
    return { ok: true, data: await listSopTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function createSopTemplateAction(input: {
  title: string;
  content?: string | null;
  position?: number;
  institutionKey?: string | null;
  changeNote?: string | null;
}) {
  try {
    const user = await requireSopEditor();
    return { ok: true, data: await createSopTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSopTemplateAction(
  sopId: number,
  patch: {
    title?: string;
    content?: string | null;
    isActive?: boolean;
    position?: number;
    institutionKey?: string | null;
    changeNote?: string | null;
  },
) {
  try {
    const user = await requireSopEditor();
    return { ok: true, data: await updateSopTemplate(user.id, sopId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteSopTemplateAction(sopId: number): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requireSopEditor();
    await deleteSopTemplate(user.id, sopId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function applySopToClientAction(sopId: number, clientId: number) {
  try {
    const user = await requireStaff();
    const entry = await applySopToClient(user.id, sopId, clientId);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: entry };
  } catch (error) {
    return fail(error);
  }
}

export async function listClientManualEntriesAction(clientId: number) {
  try {
    await requireStaff();
    return { ok: true, data: await listClientManualEntries(clientId) };
  } catch (error) {
    return fail(error);
  }
}

// ── Ad-hoc templates (§19 system 2) ───────────────────────────────────────

export async function listAdHocTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listAdHocTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function createAdHocTemplateAction(input: AdHocTemplateInput) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await createAdHocTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateAdHocTemplateAction(templateId: number, patch: Partial<AdHocTemplateInput>) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await updateAdHocTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteAdHocTemplateAction(templateId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteAdHocTemplate(user.id, templateId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function linkSopToAdHocTemplateAction(sopTemplateId: number, adHocTemplateId: number) {
  try {
    await requireTaskTemplateEditor();
    await linkSopToAdHocTemplate(sopTemplateId, adHocTemplateId);
    return { ok: true, data: { linked: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function mintAdHocTaskAction(
  templateId: number,
  clientId: number,
  overrides?: { assigneeId?: number | null; dueDate?: string },
) {
  try {
    const user = await requireStaff();
    const task = await mintAdHocTask(templateId, clientId, user.id, undefined, overrides);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

// ── Recurring templates (§19 system 3) - CRUD only; application happens at
//    conversion via defaultRuleSpecs() in src/server/convert.ts ────────────

export async function listRecurringTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listRecurringTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function createRecurringTemplateAction(input: RecurringTemplateInput) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await createRecurringTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateRecurringTemplateAction(templateId: number, patch: Partial<RecurringTemplateInput>) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await updateRecurringTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRecurringTemplateAction(templateId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteRecurringTemplate(user.id, templateId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

// ── Onboarding / offboarding templates (§19 systems 4+5) ──────────────────

export async function listOnboardingTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listOnboardingTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function createOnboardingTemplateAction(input: {
  title: string;
  description?: string | null;
  isAdminPhase?: boolean;
  defaultAssigneeRole?: string | null;
  position?: number;
}) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await createOnboardingTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateOnboardingTemplateAction(
  templateId: number,
  patch: Partial<{
    title: string;
    description: string | null;
    isAdminPhase: boolean;
    defaultAssigneeRole: string | null;
    position: number;
    isActive: boolean;
  }>,
) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await updateOnboardingTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteOnboardingTemplateAction(templateId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteOnboardingTemplate(user.id, templateId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function listOffboardingTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listOffboardingTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function createOffboardingTemplateAction(input: {
  title: string;
  description?: string | null;
  defaultAssigneeRole?: string | null;
  position?: number;
}) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await createOffboardingTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateOffboardingTemplateAction(
  templateId: number,
  patch: Partial<{
    title: string;
    description: string | null;
    defaultAssigneeRole: string | null;
    position: number;
    isActive: boolean;
  }>,
) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await updateOffboardingTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteOffboardingTemplateAction(templateId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteOffboardingTemplate(user.id, templateId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

// ── Project templates (§19 system 6) ──────────────────────────────────────

export async function listProjectTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listProjectTemplates(true) };
  } catch (error) {
    return fail(error);
  }
}

export async function getProjectTemplateAction(templateId: number) {
  try {
    await requireStaff();
    return { ok: true, data: await getProjectTemplateWithTasks(templateId) };
  } catch (error) {
    return fail(error);
  }
}

export async function createProjectTemplateAction(input: { name: string; description?: string | null }) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await createProjectTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProjectTemplateAction(
  templateId: number,
  patch: { name?: string; description?: string | null; isActive?: boolean },
) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await updateProjectTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProjectTemplateAction(templateId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteProjectTemplate(user.id, templateId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function addProjectTemplateTaskAction(templateId: number, input: ProjectTemplateTaskInput) {
  try {
    const user = await requireTaskTemplateEditor();
    return { ok: true, data: await addProjectTemplateTask(user.id, templateId, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProjectTemplateTaskAction(taskId: number) {
  try {
    const user = await requireTaskTemplateEditor();
    await deleteProjectTemplateTask(user.id, taskId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function createProjectFromTemplateAction(
  clientId: number,
  templateId: number,
  name: string,
  options?: { description?: string | null; dueDate?: string | null; startDate?: string | null },
) {
  try {
    const user = await requireStaff();
    const result = await createProjectFromTemplate(clientId, templateId, name, user.id, options);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

// ── Offboarding lifecycle (§22) ───────────────────────────────────────────

export async function startOffboardingAction(clientId: number) {
  try {
    // §22: admin/owner, or the client's assigned manager.
    const actor = await requireStaff();
    const isAdmin = actor.normalizedRole === "admin" || actor.normalizedRole === "owner";
    if (!isAdmin) {
      const [client] = await db
        .select({ managerId: clients.managerId })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client || client.managerId !== actor.id) {
        throw new AuthError(403, "Only an admin, owner, or the client's manager can start offboarding");
      }
    }
    const result = await startOffboarding(clientId, actor.id);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** §20/§22: toggle a project task; the last offboarding completion finalizes. */
export async function setProjectTaskCompletedAction(projectTaskId: number, completed: boolean) {
  try {
    const user = await requireStaff();
    const result = await setProjectTaskCompleted(projectTaskId, completed, user.id);
    revalidatePath("/clients");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Re-checks finalization; also callable by the task-completion surface. */
export async function finalizeOffboardingAction(clientId: number) {
  try {
    const user = await requireStaff();
    const result = await finalizeOffboardingWhenComplete(clientId, user.id);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
