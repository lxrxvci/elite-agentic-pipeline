"use server";

import { requireStaff } from "@/server/auth/guards";
import {
  deleteSavedView,
  type SavedViewContext,
  importSavedViews,
  listSavedViews,
  saveSavedView,
  type SavedViewRecord,
  type WorkstationViewFilters,
} from "@/server/saved-views";

import type { ActionResult } from "./quick-add";

/**
 * Saved-view server actions - staff-scoped (the views are per user, so the
 * session user is the only owner ever touched). Errors come back as typed
 * ActionResults so the workstation can toast the conflict message verbatim.
 */

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function listSavedViewsAction(
  context: SavedViewContext,
): Promise<ActionResult<SavedViewRecord[]>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await listSavedViews(user.id, context) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveSavedViewAction(
  context: SavedViewContext,
  name: string,
  filters: WorkstationViewFilters,
): Promise<ActionResult<SavedViewRecord>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await saveSavedView(user.id, context, name, filters) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteSavedViewAction(
  context: SavedViewContext,
  name: string,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requireStaff();
    await deleteSavedView(user.id, context, name);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

/** One-time localStorage import; the engine no-ops unless the DB is empty. */
export async function importSavedViewsAction(
  context: SavedViewContext,
  views: { name: string; filters: WorkstationViewFilters }[],
): Promise<ActionResult<{ imported: number }>> {
  try {
    const user = await requireStaff();
    const imported = await importSavedViews(user.id, context, views);
    return { ok: true, data: { imported } };
  } catch (error) {
    return fail(error);
  }
}
