"use server";

import { revalidatePath } from "next/cache";

import {
  AuthError,
  canEditTaxTemplates,
  requirePortalUser,
  requireRole,
  requireStaff,
} from "@/server/auth/guards";
import {
  addCpaChecklistNote,
  addCustomItem,
  createYearEndTemplate,
  ensureYearEndTemplates,
  getOrCreateClientChecklist,
  getTaxHub,
  listYearEndTemplates,
  populateAllChecklists,
  resetYearEndTemplates,
  setChecklistItemComplete,
  updateYearEndTemplate,
} from "@/server/tax";

/**
 * Year-end tax server actions (HANDOFF §18). Template edits need
 * can_edit_tax_templates (owner/admin pass by construction, §11); custom
 * items are manager+; the December bulk populate is manager+; the CPA note
 * path is portal-side and validates the linked-client set in the engine.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

async function requireTaxTemplateEditor() {
  const user = await requireStaff();
  if (!canEditTaxTemplates(user)) throw new AuthError(403, "Requires the can_edit_tax_templates permission");
  return user;
}

export async function listYearEndTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await listYearEndTemplates() };
  } catch (error) {
    return fail(error);
  }
}

export async function createYearEndTemplateAction(input: {
  title: string;
  description?: string | null;
  defaultAssigneeRole?: string | null;
  position?: number;
}) {
  try {
    const user = await requireTaxTemplateEditor();
    return { ok: true, data: await createYearEndTemplate(user.id, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function updateYearEndTemplateAction(
  templateId: number,
  patch: {
    title?: string;
    description?: string | null;
    defaultAssigneeRole?: string | null;
    position?: number;
    isActive?: boolean;
  },
) {
  try {
    const user = await requireTaxTemplateEditor();
    return { ok: true, data: await updateYearEndTemplate(user.id, templateId, patch) };
  } catch (error) {
    return fail(error);
  }
}

/** §18 - admins / can_edit_tax_templates holders can reset to defaults. */
export async function resetYearEndTemplatesAction() {
  try {
    const user = await requireTaxTemplateEditor();
    return { ok: true, data: await resetYearEndTemplates(user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function ensureYearEndTemplatesAction() {
  try {
    await requireStaff();
    return { ok: true, data: await ensureYearEndTemplates() };
  } catch (error) {
    return fail(error);
  }
}

export async function getClientChecklistAction(clientId: number, year: number) {
  try {
    await requireStaff();
    return { ok: true, data: await getOrCreateClientChecklist(clientId, year) };
  } catch (error) {
    return fail(error);
  }
}

export async function addCustomChecklistItemAction(
  clientId: number,
  year: number,
  title: string,
  assigneeId?: number | null,
) {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const item = await addCustomItem(clientId, year, title, user.id, assigneeId);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: item };
  } catch (error) {
    return fail(error);
  }
}

export async function setChecklistItemCompleteAction(itemId: number, complete: boolean) {
  try {
    const user = await requireStaff();
    return { ok: true, data: await setChecklistItemComplete(itemId, user.id, complete) };
  } catch (error) {
    return fail(error);
  }
}

/** §18 - the December workflow: populate every active client for the year. */
export async function populateAllChecklistsAction(year: number) {
  try {
    await requireRole("manager", "admin", "owner");
    return { ok: true, data: await populateAllChecklists(year) };
  } catch (error) {
    return fail(error);
  }
}

export async function getTaxHubAction(year: number) {
  try {
    await requireStaff();
    return { ok: true, data: await getTaxHub(year) };
  } catch (error) {
    return fail(error);
  }
}

/** §12/§18 - CPA portal note on one checklist item. */
export async function addCpaChecklistNoteAction(clientId: number, year: number, itemId: number, note: string) {
  try {
    const user = await requirePortalUser();
    const item = await addCpaChecklistNote(user, clientId, year, itemId, note);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: item };
  } catch (error) {
    return fail(error);
  }
}
