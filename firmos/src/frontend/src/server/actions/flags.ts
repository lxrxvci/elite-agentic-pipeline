"use server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireStaff } from "@/server/auth/guards";

/** K7 (G2): the focus-mode flag syncs server-side so reminder jobs respect it. */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function setFocusModeAction(on: boolean): Promise<ActionResult<{ focusMode: boolean }>> {
  try {
    const user = await requireStaff();
    await db.update(users).set({ focusMode: on }).where(eq(users.id, user.id));
    return { ok: true, data: { focusMode: on } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong - try again.";
    return { ok: false, error: message };
  }
}
