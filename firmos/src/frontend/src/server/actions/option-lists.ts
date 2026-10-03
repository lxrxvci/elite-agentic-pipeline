"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireRole, requireStaff } from "@/server/auth/guards";
import {
  addOptionValue,
  listOptionValues,
  OPTION_LISTS,
  renameOptionValue,
  setOptionValueActive,
  type OptionValueRow,
} from "@/server/option-lists";

/**
 * K3: option-list actions. Reads are staff-level (the intake consumes them);
 * admin management (rename/deactivate) is owner/admin; ADD is staff-level -
 * the intake's inline add-new is the whole point of DB1 ("once added through
 * an intake, it stays in the database for future use").
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function listOptionValuesAction(listKey: string): Promise<ActionResult<OptionValueRow[]>> {
  try {
    await requireStaff();
    return { ok: true, data: await listOptionValues(listKey) };
  } catch (error) {
    return fail(error);
  }
}

/** All registered lists with their values for the admin manager. */
export async function listOptionListsAdminAction(): Promise<
  ActionResult<Array<{ key: string; label: string; noun: string; values: OptionValueRow[] }>>
> {
  try {
    await requireStaff();
    const out = [];
    for (const def of Object.values(OPTION_LISTS)) {
      out.push({ key: def.key, label: def.label, noun: def.noun, values: await listOptionValues(def.key, true) });
    }
    return { ok: true, data: out };
  } catch (error) {
    return fail(error);
  }
}

export async function addOptionValueAction(listKey: string, name: string): Promise<ActionResult<OptionValueRow>> {
  try {
    const user = await requireStaff();
    const row = await addOptionValue(listKey, name, user.id);
    revalidatePath("/admin/option-lists");
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function renameOptionValueAction(listKey: string, id: number, name: string): Promise<ActionResult<OptionValueRow>> {
  try {
    const user = await requireRole("owner", "admin");
    const row = await renameOptionValue(listKey, id, name, user.id);
    revalidatePath("/admin/option-lists");
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function setOptionValueActiveAction(
  listKey: string,
  id: number,
  active: boolean,
): Promise<ActionResult<OptionValueRow>> {
  try {
    const user = await requireRole("owner", "admin");
    const row = await setOptionValueActive(listKey, id, active, user.id);
    revalidatePath("/admin/option-lists");
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}
