"use server";

import { requireStaff, type UserRole } from "@/server/auth/guards";
import { globalSearch, type SearchResults } from "@/server/search";

import type { ActionResult } from "./quick-add";

/**
 * Palette server actions: debounced global search plus the one-shot context
 * read the palette needs to gate role-aware actions (Generate invoices is
 * manager+ per §15). Both are staff-only - portal roles are rejected at the
 * guard and surface as a typed failure, never a thrown 500.
 */

export async function globalSearchAction(query: string): Promise<ActionResult<SearchResults>> {
  try {
    const user = await requireStaff();
    if (typeof query !== "string") return { ok: false, error: "That search was malformed." };
    return { ok: true, data: await globalSearch(query, user.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed - try again.";
    return { ok: false, error: message };
  }
}

export interface PaletteContext {
  role: UserRole;
}

export async function paletteContextAction(): Promise<ActionResult<PaletteContext>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: { role: user.normalizedRole } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong - try again.";
    return { ok: false, error: message };
  }
}
