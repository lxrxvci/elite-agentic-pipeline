"use server";

import { revalidatePath } from "next/cache";

import {
  AuthError,
  canEditSops,
  requireStaff,
} from "@/server/auth/guards";
import {
  deleteSopVideo,
  listSopVideos,
  registerSopVideo,
  sopVideoStorageMode,
  type RegisterSopVideoInput,
  type SopVideoRow,
} from "@/server/sop-videos";
import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES } from "@/server/uploads";

/**
 * K2: SOP video actions. Writes (register/delete) require can_edit_sops -
 * the same flag as SOP editing; reads (list, upload-mode) are staff-level so
 * every bookkeeper can watch walkthroughs in the drawer.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

async function requireSopEditor() {
  const user = await requireStaff();
  if (!canEditSops(user)) throw new AuthError(403, "Requires the can_edit_sops permission");
  return user;
}

/** The recorder asks this first: client-direct blob upload, or local POST? */
export async function sopVideoUploadModeAction(): Promise<
  ActionResult<{ mode: "local" | "vercel-blob"; maxBytes: number }>
> {
  try {
    await requireStaff();
    return { ok: true, data: { mode: sopVideoStorageMode(), maxBytes: MAX_VIDEO_BYTES } };
  } catch (error) {
    return fail(error);
  }
}

export async function listSopVideosAction(sopTemplateIds: number[]): Promise<ActionResult<SopVideoRow[]>> {
  try {
    await requireStaff();
    const ids = sopTemplateIds.filter((id) => Number.isInteger(id) && id > 0);
    return { ok: true, data: await listSopVideos(ids) };
  } catch (error) {
    return fail(error);
  }
}

/** Register the row AFTER the bytes landed (blob client-direct or local PUT). */
export async function registerSopVideoAction(input: RegisterSopVideoInput): Promise<ActionResult<SopVideoRow>> {
  try {
    const user = await requireSopEditor();
    if (!VIDEO_MIME_TYPES.has((input.mimeType ?? "").toLowerCase())) {
      return { ok: false, error: "Only webm and mp4 recordings can be registered." };
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_VIDEO_BYTES) {
      return { ok: false, error: "The recording size is missing or over the 500 MB limit." };
    }
    const row = await registerSopVideo(input, user.id);
    revalidatePath("/admin/templates/sops");
    revalidatePath("/workstation");
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteSopVideoAction(videoId: number): Promise<ActionResult<{ deleted: true }>> {
  try {
    const user = await requireSopEditor();
    const result = await deleteSopVideo(videoId, user.id);
    revalidatePath("/admin/templates/sops");
    revalidatePath("/workstation");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
