"use server";

import { getCloseSteps, type CloseSteps } from "@/server/year-grid";

/**
 * Guided-close read for the task drawer: when the open task is one of the
 * four recurring close steps (Categorize / Reconcile / Client Questions /
 * Send Reports), the drawer shows the month's stepper state in context.
 * The engine read enforces requireStaff itself.
 */

export type CloseStepsResult = { ok: true; data: CloseSteps } | { ok: false; error: string };

export async function getCloseStepsAction(
  clientId: number,
  year: number,
  month: number,
): Promise<CloseStepsResult> {
  try {
    const data = await getCloseSteps(clientId, year, month);
    if (!data) return { ok: false, error: "Client not found." };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
