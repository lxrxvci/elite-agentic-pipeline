"use server";

import { AuthError, requireStaff } from "@/server/auth/guards";
import {
  ChatError,
  createClientPortalChannel as provisionClientChannel,
  getChannelMembers,
  getChannelMessages,
  getOrCreateDm,
  getPresence,
  listChannels,
  listStaffForDm,
  markChannelRead,
  sendMessage,
  type ChannelMessagesPage,
  type ChatChannelSummary,
  type ChatMessageView,
  type ChatPerson,
  type PresenceEntry,
} from "@/server/chat";
import { UploadValidationError } from "@/server/uploads";

/**
 * Team chat server actions (HANDOFF §16). Every action resolves the caller
 * through requireStaff (portal roles are rejected outright, §11) and the
 * engine enforces channel membership by construction - a non-member cannot
 * read, post, or mark read through this surface.
 *
 * Results are typed ActionResult so the UI can show human-readable reasons
 * (validation, membership) verbatim and stays generic about internals.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ChatError || error instanceof UploadValidationError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof AuthError) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: false, error: "Something went wrong - try again." };
}

export async function listChannelsAction(): Promise<ActionResult<ChatChannelSummary[]>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await listChannels(user.id) };
  } catch (error) {
    return failure(error);
  }
}

export async function channelMessagesAction(
  channelId: number,
  opts: { before?: number; after?: number; limit?: number } = {},
): Promise<ActionResult<ChannelMessagesPage>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await getChannelMessages(channelId, user.id, opts) };
  } catch (error) {
    return failure(error);
  }
}

export async function channelMembersAction(
  channelId: number,
): Promise<ActionResult<ChatPerson[]>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await getChannelMembers(channelId, user.id) };
  } catch (error) {
    return failure(error);
  }
}

export async function openDmAction(otherUserId: number): Promise<ActionResult<{ channelId: number }>> {
  try {
    const user = await requireStaff();
    const channel = await getOrCreateDm(user.id, otherUserId);
    return { ok: true, data: { channelId: channel.id } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Post a message with an optional single attachment (FormData fields:
 * channelId, body, file?). Attachment bytes ride the multipart body; the
 * §13 validation layers run in the engine.
 */
export async function sendMessageAction(
  formData: FormData,
): Promise<ActionResult<{ message: ChatMessageView }>> {
  try {
    const user = await requireStaff();
    const channelId = Number(formData.get("channelId"));
    if (!Number.isInteger(channelId)) return { ok: false, error: "Channel is missing." };
    const rawBody = formData.get("body");
    const body = typeof rawBody === "string" ? rawBody : "";

    let attachment: { fileName: string; mimeType: string | null; bytes: Uint8Array } | undefined;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      attachment = {
        fileName: file.name,
        mimeType: file.type || null,
        bytes: new Uint8Array(await file.arrayBuffer()),
      };
    }

    const result = await sendMessage(channelId, user.id, body, attachment);
    return { ok: true, data: { message: result.message } };
  } catch (error) {
    return failure(error);
  }
}

export async function markChannelReadAction(
  channelId: number,
): Promise<ActionResult<{ read: true }>> {
  try {
    const user = await requireStaff();
    await markChannelRead(channelId, user.id);
    return { ok: true, data: { read: true } };
  } catch (error) {
    return failure(error);
  }
}

export async function presenceAction(): Promise<ActionResult<PresenceEntry[]>> {
  try {
    await requireStaff();
    return { ok: true, data: await getPresence() };
  } catch (error) {
    return failure(error);
  }
}

/** People picker for the new-DM flow: active staff excluding the caller. */
export async function staffPickerAction(): Promise<ActionResult<ChatPerson[]>> {
  try {
    const user = await requireStaff();
    return { ok: true, data: await listStaffForDm(user.id) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Portal provisioning seam (§16): idempotent client_portal channel creation.
 * Not wired into the staff UI - the portal flow calls this when a portal
 * user is provisioned. Restricted to owner/admin/manager.
 */
export async function provisionClientChannelAction(
  clientId: number,
): Promise<ActionResult<{ channelId: number }>> {
  try {
    const user = await requireStaff();
    if (!["owner", "admin", "manager"].includes(user.normalizedRole)) {
      return { ok: false, error: "You do not have permission to do that." };
    }
    const channel = await provisionClientChannel(clientId);
    return { ok: true, data: { channelId: channel.id } };
  } catch (error) {
    return failure(error);
  }
}
