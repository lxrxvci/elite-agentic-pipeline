"use server";

import { requireStaff } from "@/server/auth/guards";
import {
  addIndustrySuggestion,
  listIndustrySuggestions,
  type IndustrySuggestionRow,
} from "@/server/industry-suggestions";

/** K6 (D2): the services screen's industry suggestions read (staff-level). */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function listIndustrySuggestionsAction(
  industry: string | null,
): Promise<ActionResult<IndustrySuggestionRow[]>> {
  try {
    await requireStaff();
    return { ok: true, data: await listIndustrySuggestions(industry) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong - try again.";
    return { ok: false, error: message };
  }
}

/** L2 (H7, 10_06 00:35:38): a custom add-on tagged to an industry joins the
 *  suggestion engine (staff-level - intake data entry). */
export async function tagCustomAddonIndustryAction(
  industry: string,
  title: string,
): Promise<ActionResult<IndustrySuggestionRow | null>> {
  try {
    await requireStaff();
    const row = await addIndustrySuggestion(industry, `custom:${title}`, "A custom add-on from a prior intake.");
    return { ok: true, data: row };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong - try again.";
    return { ok: false, error: message };
  }
}
