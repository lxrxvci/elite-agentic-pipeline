"use server";

import { revalidatePath } from "next/cache";

import {
  getPurgatoryQueue,
  isPurgeEnabled,
  pauseClientDirectly,
  requestClientPause,
  requestClientPurge,
  requestClientReset,
  reviewPauseRequest,
  reviewPortalChangeRequest,
  reviewPurgeRequest,
  reviewResetRequest,
  reviewWorkingHours,
  submitWorkingHours,
  type PurgatoryItem,
} from "@/server/approvals";
import { requireRole, requireStaff } from "@/server/auth/guards";

/**
 * Approval workflow server actions (HANDOFF §22). Role guards per the spec
 * table; the engine enforces the different-approver rule and applies the
 * effects. Purge/reset requesters are admins, reviewers owners.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

// ── Pause (manager+ requests; admin/owner reviews) ────────────────────────

export async function requestPauseAction(
  clientId: number,
  reason?: string,
): Promise<ActionResult<{ requestId: number }>> {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const request = await requestClientPause(clientId, user.id, reason);
    revalidatePath("/admin/purgatory");
    return { ok: true, data: { requestId: request.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewPauseAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("admin", "owner");
    const request = await reviewPauseRequest(requestId, reviewer.id, approve);
    revalidatePath("/admin/purgatory");
    revalidatePath(`/clients/${request.clientId}`);
    return { ok: true, data: { status: request.status } };
  } catch (error) {
    return fail(error);
  }
}

/** §22: admins and owners may also pause directly, without the request flow. */
export async function pauseClientDirectlyAction(clientId: number): Promise<ActionResult<{ isPaused: boolean }>> {
  try {
    const actor = await requireRole("admin", "owner");
    const client = await pauseClientDirectly(clientId, actor.id);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: { isPaused: client.isPaused } };
  } catch (error) {
    return fail(error);
  }
}

// ── Purge (admin requests; owner reviews; feature-flag gated) ─────────────

export async function isPurgeEnabledAction(): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: { enabled: await isPurgeEnabled() } };
  } catch (error) {
    return fail(error);
  }
}

export async function requestPurgeAction(
  clientId: number,
  reason?: string,
): Promise<ActionResult<{ requestId: number }>> {
  try {
    const user = await requireRole("admin");
    const request = await requestClientPurge(clientId, user.id, reason);
    revalidatePath("/admin/purgatory");
    return { ok: true, data: { requestId: request.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewPurgeAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("owner");
    const result = await reviewPurgeRequest(requestId, reviewer.id, approve);
    revalidatePath("/admin/purgatory");
    return { ok: true, data: { status: result.status } };
  } catch (error) {
    return fail(error);
  }
}

// ── Reset (admin requests; owner reviews) ─────────────────────────────────

export async function requestResetAction(
  clientId: number,
  reason?: string,
): Promise<ActionResult<{ requestId: number }>> {
  try {
    const user = await requireRole("admin");
    const request = await requestClientReset(clientId, user.id, reason);
    revalidatePath("/admin/purgatory");
    return { ok: true, data: { requestId: request.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewResetAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("owner");
    const result = await reviewResetRequest(requestId, reviewer.id, approve);
    revalidatePath("/admin/purgatory");
    return { ok: true, data: { status: result.status } };
  } catch (error) {
    return fail(error);
  }
}

// ── Working hours (any staff submits; admin/owner reviews) ────────────────

export async function submitWorkingHoursAction(
  schedule: Record<string, unknown>,
): Promise<ActionResult<{ requestId: number }>> {
  try {
    const user = await requireStaff();
    const row = await submitWorkingHours(user.id, schedule);
    return { ok: true, data: { requestId: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewWorkingHoursAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("admin", "owner");
    const row = await reviewWorkingHours(requestId, reviewer.id, approve);
    return { ok: true, data: { status: row.status } };
  } catch (error) {
    return fail(error);
  }
}

// ── Portal change requests (admin/owner reviews) ──────────────────────────

export async function reviewPortalChangeAction(
  requestId: number,
  approve: boolean,
): Promise<ActionResult<{ status: string }>> {
  try {
    const reviewer = await requireRole("admin", "owner");
    const request = await reviewPortalChangeRequest(requestId, reviewer.id, approve);
    revalidatePath("/admin/purgatory");
    revalidatePath(`/clients/${request.clientId}`);
    return { ok: true, data: { status: request.status } };
  } catch (error) {
    return fail(error);
  }
}

// ── Purgatory queue (§22 + the reset fix) ─────────────────────────────────

export async function getPurgatoryQueueAction(): Promise<ActionResult<PurgatoryItem[]>> {
  try {
    await requireRole("admin", "owner");
    return { ok: true, data: await getPurgatoryQueue() };
  } catch (error) {
    return fail(error);
  }
}
