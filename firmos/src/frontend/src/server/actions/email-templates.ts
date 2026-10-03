"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireRole } from "@/server/auth/guards";
import {
  EMAIL_TEMPLATE_DEFS,
  getEmailTemplateOverrides,
  setEmailTemplateOverride,
} from "@/server/email-template-overrides";

/** K3 (J16): email copy actions - reads staff-level, writes owner/admin. */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function getEmailTemplatesAdminAction(): Promise<
  ActionResult<{ defs: typeof EMAIL_TEMPLATE_DEFS; overrides: Record<string, { subject?: string | null; footnote?: string | null }> }>
> {
  try {
    await requireRole("admin", "owner");
    const map = await getEmailTemplateOverrides();
    return { ok: true, data: { defs: EMAIL_TEMPLATE_DEFS, overrides: Object.fromEntries(map) } };
  } catch (error) {
    return fail(error);
  }
}

export async function setEmailTemplateOverrideAction(
  key: string,
  input: { subject: string | null; footnote: string | null },
): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requireRole("admin", "owner");
    await setEmailTemplateOverride(key, input, user.id);
    revalidatePath("/admin/settings");
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}
