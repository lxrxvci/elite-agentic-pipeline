"use server";

import {
  clearResolved,
  getBellSummary,
  listNotifications,
  markAllRead,
  markRead,
  resolveNotifications,
  type BellSummary,
  type NotificationFilter,
  type NotificationRow,
} from "@/server/notifications";
import { getCurrentUserId } from "@/server/session";

/**
 * Notification center server actions (HANDOFF §16).
 *
 * Every action resolves the caller through the session seam and operates on
 * THAT user's rows only - there is no way to touch another user's
 * notifications through this surface.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function bellSummaryAction(): Promise<ActionResult<BellSummary>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: await getBellSummary(userId) };
  } catch (error) {
    return fail(error);
  }
}

export async function listNotificationsAction(
  filter: NotificationFilter = "unread",
  limit = 50,
): Promise<ActionResult<NotificationRow[]>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: await listNotifications(userId, { filter, limit }) };
  } catch (error) {
    return fail(error);
  }
}

export async function markNotificationsReadAction(
  ids: number[],
): Promise<ActionResult<{ updated: number }>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: { updated: await markRead(userId, ids) } };
  } catch (error) {
    return fail(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ updated: number }>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: { updated: await markAllRead(userId) } };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveNotificationsAction(
  ids: number[],
): Promise<ActionResult<{ updated: number }>> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: { updated: await resolveNotifications(userId, ids) } };
  } catch (error) {
    return fail(error);
  }
}

export async function clearResolvedNotificationsAction(): Promise<
  ActionResult<{ cleared: number }>
> {
  try {
    const userId = await getCurrentUserId();
    return { ok: true, data: { cleared: await clearResolved(userId) } };
  } catch (error) {
    return fail(error);
  }
}
