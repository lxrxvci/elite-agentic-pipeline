"use server";

import { requireStaff } from "@/server/auth/guards";
import { listIndustrySuggestions, type IndustrySuggestionRow } from "@/server/industry-suggestions";

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
